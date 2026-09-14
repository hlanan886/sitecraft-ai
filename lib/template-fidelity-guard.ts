/**
 * 模板忠实度门禁（可扩展注册表架构）。
 *
 * 背景：产检测反馈"AI 自己兜底、只套了一个背景图"。原检测有两个盲区：
 *  1. `detectTemplateDemoResidue` 只查 manifest.slots 内的文本——模板自带的
 *     **非槽位残留区块**（英文 SaaS 看板、demo 组件）谁也拦不住；
 *  2. 判定"该节是否落在模板原生结构"依赖 `presentAs` 中文文案正则（脆弱，改文案即失效）。
 *
 * 本模块提供三层门禁，并把"可扩展"做成**注册表驱动**：
 *  - 新增模板/行业/节类型时，只需注册，不改门禁代码；
 *  - 用户后续要据此丰富模板（机械/五金/家具/食品/电子/化工/互联网/政府），
 *    新节只需 `registerSectionType()` 一次即被纳入检测。
 *
 * 三层：
 *  - L1 槽位层：该填的槽是否填了 / 是否残留 demo（复用现有 coverage 逻辑）
 *  - L2 区块层：非槽位残留区块（英文看板等）——新增能力
 *  - L3 结构层：该节落在原生结构 vs 通用兜底（bridge 的 generatedContentSections）
 */

// ===== 注册表：节类型（可扩展） =====

import { isHeroAssetDemo, matchesHeroAssetSelector } from "./template-asset-registry.ts";

export type SectionTypeRegistration = {
  /** 节标识（如 about/features/certificate/strength/news/map） */
  key: string;
  /** 中文名（诊断报告用） */
  label: string;
  /** 是否要求必须落在模板原生结构（true 则 generated 兜底判 FAIL） */
  requiresNative: boolean;
  /** 该节的内容槽（用于 L1 检查） */
  targets: string[];
  /** 该节在模板里的呈现角色（对应 manifest presentation.role） */
  presentationRole?: string;
};

const sectionRegistry = new Map<string, SectionTypeRegistration>();

/** 注册一个节类型。新增行业节（资质墙/厂房/新闻/地图）时调用一次即可。 */
export function registerSectionType(reg: SectionTypeRegistration): void {
  sectionRegistry.set(reg.key, reg);
}

export function getSectionTypes(): SectionTypeRegistration[] {
  return [...sectionRegistry.values()];
}

export function getSectionType(key: string): SectionTypeRegistration | undefined {
  return sectionRegistry.get(key);
}

/** 测试用：重置注册表到内置状态（不清空内置节） */
export function resetSectionRegistry(): void {
  sectionRegistry.clear();
  BUILTIN.forEach((reg) => sectionRegistry.set(reg.key, reg));
}

// 内置的 corporate 五节（与现有 manifest 对齐）
const BUILTIN: SectionTypeRegistration[] = [
  { key: "about", label: "关于", requiresNative: false, targets: ["about.body"], presentationRole: "split_text_media" },
  { key: "features", label: "核心优势", requiresNative: true, targets: ["features.items"], presentationRole: "icon_row" },
  { key: "services", label: "服务", requiresNative: true, targets: ["services.items"], presentationRole: "icon_row" },
  { key: "products", label: "产品", requiresNative: false, targets: ["products"], presentationRole: "product_grid" },
  { key: "contact", label: "联系", requiresNative: false, targets: ["contact.title", "contact.body", "contact.email", "contact.phone", "contact.address"], presentationRole: "split_text_media" },
];
BUILTIN.forEach(registerSectionType);

// ===== 残留区块特征（可扩展） =====

export type ResidualBlockPattern = {
  /** 特征标识 */
  key: string;
  /** 匹配规则（在可见文本中查找） */
  test: (text: string) => boolean;
  /** 严重度 */
  severity: "high" | "medium" | "low";
  /** 说明 */
  description: string;
};

const BUILTIN_RESIDUAL: ResidualBlockPattern[] = [
  {
    key: "saas_analytics_dashboard",
    // 实测样本：华曜站残留 "$45,385" / "Visitors this week" / "USERS REPORT" / "Products this week"
    test: (t) => /(\$\d[\d,]{2,}|Visitors this week|USERS REPORT|PRODUCTS REPORT|this week\s*\d|Last 7 days)/i.test(t),
    severity: "high",
    description: "英文 SaaS 数据看板残留（访客数/销售报表），与工厂官网无关",
  },
  {
    key: "lorem_ipsum",
    test: (t) => /lorem ipsum|dolor sit amet/i.test(t),
    severity: "high",
    description: "Lorem ipsum 占位文案残留",
  },
  {
    key: "demo_persona",
    // 模板作者人名（实测：Ryan Fitzgerald / I'm Manuel Ernesto）
    test: (t) => /(Ryan Fitzgerald|Manuel Ernesto|John Doe|Jane Smith)/i.test(t),
    severity: "high",
    description: "模板作者/示例人名残留",
  },
  {
    key: "english_marketing_copy",
    // 宽泛的英文营销文案（中英混排信号）——low 级，仅提示
    test: (t) => /(Get Started|Learn More|Sign Up Free|Start Your Free Trial|Book a Demo)/i.test(t),
    severity: "low",
    description: "英文营销 CTA 残留（可能与中文站不搭）",
  },
  {
    key: "hero_asset_business_mismatch",
    // 实测样本：华曜（光伏制造）hero 用"宇航员/太空"图——与业务完全无关。
    // 检测的是图片 URL/alt 文本（视觉预筛发现后固化）。
    test: (t) => /(astronaut|space[-_]?suit|outer[-_]?space|cosmonaut|宇航员|太空)/i.test(t),
    severity: "high",
    description: "主视觉与业务无关（如光伏站用宇航员图）——资产适配性缺陷",
  },
];

const residualPatterns: ResidualBlockPattern[] = [...BUILTIN_RESIDUAL];

export function registerResidualPattern(pattern: ResidualBlockPattern): void {
  residualPatterns.push(pattern);
}

export function getResidualPatterns(): readonly ResidualBlockPattern[] {
  return residualPatterns;
}

/** 测试用：重置到内置特征（不清空内置） */
export function resetResidualPatterns(): void {
  residualPatterns.length = 0;
  residualPatterns.push(...BUILTIN_RESIDUAL);
}

// ===== L2：残留区块检测 =====

export type ResidualBlockFinding = {
  patternKey: string;
  severity: "high" | "medium" | "low";
  description: string;
  /** 命中的文本片段（截断，供诊断） */
  evidence: string;
};

/**
 * 扫描可见文本，找出**非槽位残留区块**。
 * 这是原 `detectTemplateDemoResidue` 的补充：后者只查槽位内文本。
 */
export function detectResidualBlocks(visibleText: string | string[]): ResidualBlockFinding[] {
  const texts = Array.isArray(visibleText) ? visibleText : [visibleText];
  const findings: ResidualBlockFinding[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of residualPatterns) {
      if (seen.has(pattern.key)) continue;
      if (pattern.test(text)) {
        seen.add(pattern.key);
        findings.push({
          patternKey: pattern.key,
          severity: pattern.severity,
          description: pattern.description,
          evidence: text.slice(0, 160),
        });
      }
    }
  }
  return findings;
}

// ===== L3：结构层（原生 vs 兜底） =====

export type StructureVerdict = "native" | "generated" | "missing";

export type StructureCheck = {
  section: string;
  verdict: StructureVerdict;
  /** 该节是否要求原生（来自注册表） */
  requiresNative: boolean;
  /** 是否违规：要求原生却走了 generated */
  violation: boolean;
};

/**
 * 判定每节的结构归属。
 * @param sections           参与判定的节
 * @param generatedSections  bridge 上报的"走了通用兜底"的节（data-sitecraft-generated-content）
 * @param appliedSections    实际有内容落地的节
 * @param manifestHosts      可选：从 manifest presentation 读取的显式声明
 *                           （`nativeFallbackHost: "generated"` → 该节走兜底是设计内行为）
 */
export function checkStructure(args: {
  sections: string[];
  generatedSections: string[];
  appliedSections: string[];
  manifestHosts?: Record<string, "native" | "generated">;
}): StructureCheck[] {
  const generated = new Set(args.generatedSections);
  const applied = new Set(args.appliedSections);
  return args.sections.map((section) => {
    const reg = sectionRegistry.get(section);
    const isGenerated = generated.has(section);
    const isApplied = applied.has(section);
    const verdict: StructureVerdict = isGenerated ? "generated" : isApplied ? "native" : "missing";
    // 优先级：manifest 显式声明 > 注册表默认
    const explicitHost = args.manifestHosts?.[section];
    const requiresNative = explicitHost
      ? explicitHost === "native"
      : (reg?.requiresNative ?? false);
    return {
      section,
      verdict,
      requiresNative,
      violation: requiresNative && isGenerated,
    };
  });
}

// ===== L2b：图片资产检测（视觉预筛发现后固化） =====

export type AssetFinding = {
  patternKey: string;
  severity: "high" | "medium" | "low";
  description: string;
  /** 命中的图片 URL 或 alt */
  evidence: string;
};

const BUILTIN_ASSET_PATTERNS: ResidualBlockPattern[] = [
  {
    key: "hero_asset_business_mismatch",
    // 实测：华曜（光伏制造）hero 用宇航员/太空图 → 与业务无关
    test: (t) => /(astronaut|space[-_]?suit|outer[-_]?space|cosmonaut|宇航员|太空)/i.test(t),
    severity: "high",
    description: "主视觉与业务无关（如光伏站用宇航员图）——资产适配性缺陷",
  },
  {
    key: "hero_asset_demo_placeholder",
    // 模板 demo 图（包装盒渲染、示例人像等）
    test: (t) => /(hero-image|product-box|packaging|demo-|placeholder|example-|stock-photo)/i.test(t),
    severity: "medium",
    description: "主视觉疑似模板 demo 图（非企业实拍）",
  },
];

const assetPatterns: ResidualBlockPattern[] = [...BUILTIN_ASSET_PATTERNS];

/** 从 HTML 提取图片 src 与 alt，供资产检测 */
export function extractImageAssets(html: string): string[] {
  const assets: string[] = [];
  const imgRe = /<img[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1];
    const alt = /alt=["']([^"']*)["']/i.exec(tag)?.[1];
    if (src) assets.push(src);
    if (alt) assets.push(alt);
  }
  return assets;
}

/** 检测图片资产问题（业务不匹配、demo 占位图）
 *  @param templateId 可选：传入后启用**逐模板资产注册表**判定（lib/template-asset-registry.ts），
 *         比内置通用正则更准——内置正则只覆盖「宇航员」这一个历史样本。 */
export function detectAssetIssues(html: string, templateId?: string): AssetFinding[] {
  const assets = extractImageAssets(html);
  const findings: AssetFinding[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    for (const pattern of assetPatterns) {
      if (seen.has(pattern.key)) continue;
      if (pattern.test(asset)) {
        seen.add(pattern.key);
        findings.push({
          patternKey: pattern.key,
          severity: pattern.severity,
          description: pattern.description,
          evidence: asset.slice(0, 160),
        });
      }
    }
  }
  // 逐模板注册表：该模板首屏主视觉是否仍是 demo 素材（发布前需替换）
  if (templateId && isHeroAssetDemo(templateId)) {
    const hit = assets.find((asset) => matchesHeroAssetSelector(templateId, asset));
    if (hit && !seen.has("hero_asset_registry_demo")) {
      seen.add("hero_asset_registry_demo");
      findings.push({
        patternKey: "hero_asset_registry_demo",
        severity: "high",
        description: `首屏主视觉仍是模板 demo 素材（${templateId}）——请替换为企业实拍图后发布`,
        evidence: hit.slice(0, 160),
      });
    }
  }
  return findings;
}

// ===== 汇总门禁报告 =====

export type FidelityReport = {
  /** L2 残留区块（文本层） */
  residualBlocks: ResidualBlockFinding[];
  /** L2b 资产问题（图片层） */
  assetIssues: AssetFinding[];
  /** L3 结构判定 */
  structure: StructureCheck[];
  /** 是否通过（无 high 级残留/资产问题 + 无结构违规） */
  passed: boolean;
  /** 阻断项（供 CI 断言） */
  blockers: string[];
};

/**
 * 从 manifest 的 presentation 读取显式承载声明（`nativeFallbackHost`）。
 *
 * 此前该字段只被写入 manifest、**从未被任何地方消费**（32 处标注是死数据）——
 * 2026-09-09 接线：`evaluateFidelity` 可直接传 `templateId`，由本函数读取声明。
 * 语义：`"generated"` = 该节由通用生成区承载是设计内行为（不违规）；
 *       `"native"` = 必须原生承载；未声明则回退注册表 `requiresNative`。
 *
 * **card_grid 自动视为允许通用渲染**：`PresentationRole` 类型注释明确写着
 * "该模板此处确实用卡片（唯一允许通用卡片渲染的角色）"，而通用兜底渲染的正是卡片网格。
 * 因此 role=card_grid 的节走 generated **不是缺陷**。若不自动豁免，22 个模板里
 * 有 12 个的 services（role=card_grid）会被误判结构违规——这是系统性假阳性。
 * 显式 `nativeFallbackHost` 优先级更高，可覆盖该推导。
 */
export function manifestHostsFor(
  presentation: readonly { presentationSlot: string; role?: string; nativeFallbackHost?: "native" | "generated" }[],
): Record<string, "native" | "generated"> {
  const hosts: Record<string, "native" | "generated"> = {};
  for (const block of presentation) {
    if (block.nativeFallbackHost) hosts[block.presentationSlot] = block.nativeFallbackHost;
    else if (block.role === "card_grid") hosts[block.presentationSlot] = "generated";
  }
  return hosts;
}

export function evaluateFidelity(args: {
  visibleText: string | string[];
  sections: string[];
  generatedSections: string[];
  appliedSections: string[];
  /** 可选：原始 HTML，用于图片资产检测 */
  html?: string;
  /** 可选：模板 id，用于逐模板资产注册表判定（首屏 demo 主视觉） */
  templateId?: string;
  /** 可选：manifest 的显式承载声明（优先于注册表） */
  manifestHosts?: Record<string, "native" | "generated">;
  /**
   * 可选：模板的 presentation 数组。传入后自动从中派生 `manifestHosts`
   * （与显式传 manifestHosts 等价，后者优先）。
   */
  presentation?: readonly { presentationSlot: string; role?: string; nativeFallbackHost?: "native" | "generated" }[];
}): FidelityReport {
  const residualBlocks = detectResidualBlocks(args.visibleText);
  const assetIssues = args.html ? detectAssetIssues(args.html, args.templateId) : [];
  const structure = checkStructure({
    sections: args.sections,
    generatedSections: args.generatedSections,
    appliedSections: args.appliedSections,
    manifestHosts: args.manifestHosts ?? (args.presentation ? manifestHostsFor(args.presentation) : undefined),
  });
  const blockers: string[] = [];
  for (const finding of residualBlocks) {
    if (finding.severity === "high") blockers.push(`残留区块[${finding.patternKey}]：${finding.description}`);
  }
  for (const finding of assetIssues) {
    if (finding.severity === "high") blockers.push(`资产问题[${finding.patternKey}]：${finding.description}（${finding.evidence.slice(0, 60)}）`);
  }
  for (const check of structure) {
    if (check.violation) blockers.push(`结构违规[${check.section}]：要求原生排版却走了通用兜底`);
  }
  return { residualBlocks, assetIssues, structure, passed: blockers.length === 0, blockers };
}
