/**
 * 沉淀模板的入库质量门（2026-09-10，方向 3 阶段 C）。
 *
 * ## 为什么需要它
 *
 * 模板库是**全局复用**的——一个进库的模板会被以后每个用它建站的客户引用。
 * 而阶段 B 的产物是 **AI 生成的 HTML**，未经验证就入库等于把不可控产物
 * 变成整个系统的基础设施。回滚一个已被 N 个站点引用的模板，成本远高于
 * 入库时拦住它。
 *
 * ## 这道门能查什么、查不了什么（如实划界）
 *
 * `e2e/specs/coverage-scan.spec.ts` 的完整基线跑在**浏览器**里，因为它要
 * 桥接上报的 `appliedSlots` / `generatedContentSections`。那些数据只有真跑一遍
 * 注入才有。本模块是**静态**的（服务端、无浏览器），因此覆盖它的一个子集：
 *
 * | 维度 | 静态（本模块） | 需浏览器（coverage-scan） |
 * |---|---|---|
 * | 槽位是否声明 | ✅ 扫 HTML 属性 | ✅ |
 * | L2 残留区块（lorem/作者名/看板） | ✅ 文本特征 | ✅ |
 * | 资产问题（外链图/无关主视觉） | ✅ 图片 URL/alt | ✅ |
 * | L3 结构（原生 vs 兜底） | ❌ **不适用** | ✅ |
 * | 注入后槽位是否真的可见 | ❌ | ✅ |
 *
 * **L3 对沉淀模板不适用**这件事要说清楚：L3 判的是「该用模板原生排版却走了通用兜底」，
 * 而运行时模板**本来就没有原生排版**——它们全部由通用引擎渲染。把 L3 套上来，
 * 每个沉淀模板都会"违规"，门就失去意义了。
 * 所以：**静态门是必要条件，不是充分条件**；浏览器基线仍是终审。
 */

import type { SectionTypeRegistration } from "./template-fidelity-guard.ts";
import { detectAssetIssues, detectResidualBlocks } from "./template-fidelity-guard.ts";
import { collectSlotTargetsFromHtmlString } from "./template-runtime-loader.ts";
import { isCollectionTarget } from "./template-runtime.ts";

export type TemplateQualityIssue = {
  /** 机器可读标识（测试与诊断按它断言，不按中文描述）。 */
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

export type TemplateQualityReport = {
  passed: boolean;
  /** 模板 HTML 里声明的槽位（两段式 target）。 */
  slotTargets: string[];
  /** 达到「能被 AI 填充」下限所需的槽位中，实际缺失的那些。 */
  missingRequiredSlots: string[];
  issues: TemplateQualityIssue[];
  blockers: string[];
  warnings: string[];
};

/**
 * 「能当模板用」的**下限**。
 *
 * 只列两条，且都是可辩护的：
 *  - `hero.title`：没有首屏标题，站点连"是什么"都说不清；
 *  - **至少一个集合槽**（features/services/products 任一）：没有它，AI 没有任何
 *    可批量填充的内容位——那是一个**静态页**，不是模板。用户拿它建站后会发现
 *    「除了首屏什么都改不了」，正是阶段 A 用 secttre 实测到的状态。
 *
 * 刻意**不要求** about / contact / products 齐全：很多真实模板本就没有产品目录
 * （律所、政府站），把"齐全"当门槛会把正常模板也拦下。
 */
const REQUIRED_SLOT_RULES: ReadonlyArray<{ label: string; test: (targets: readonly string[]) => boolean }> = [
  { label: "hero.title", test: (targets) => targets.includes("hero.title") },
  {
    label: "features.items 或 services.items 或 products 之一",
    test: (targets) => targets.some((target) => isCollectionTarget(target) && target !== "about.body"),
  },
];

function buildSectionRegistrations(targets: readonly string[]): SectionTypeRegistration[] {
  const bySection = new Map<string, string[]>();
  for (const target of targets) {
    const key = target.split(".")[0];
    if (!key) continue;
    bySection.set(key, [...(bySection.get(key) ?? []), target]);
  }
  return [...bySection].map(([key, sectionTargets]) => ({
    key,
    label: key,
    // 运行时模板本就由通用引擎渲染，强制原生会让每个模板都判 FAIL。
    requiresNative: false,
    targets: sectionTargets,
    presentationRole: sectionTargets.some((target) => isCollectionTarget(target)) ? "card_grid" : "split_text_media",
  }));
}

/**
 * 从门禁报告派生**忠实度门禁的节注册**。
 *
 * 单独暴露而不是塞进报告：`TemplateQualityReport` 是「结论」，节注册是给另一个
 * 子系统的**输入**。混在一起会让报告的类型依赖门禁模块（types.ts ↔ 本模块 成环）。
 */
export function sectionRegistrationsFor(report: TemplateQualityReport): SectionTypeRegistration[] {
  return buildSectionRegistrations(report.slotTargets);
}

/**
 * 评测一份**即将入库**的模板 HTML。
 *
 * 纯函数：不碰磁盘、不碰注册表。这样它能被单测直接喂字符串，
 * 也能在写入前调用（此时模板还不存在于任何地方）。
 *
 * @param html 经过槽位补全后的最终 HTML——判的必须是**将要被服务出去的那一份**，
 *             补全前的那份可能还没打上 `data-sitecraft-slot`。
 * @param templateId 仅用于逐模板资产判定（首屏 demo 主视觉注册表）。
 */
export function evaluateTemplateQuality(args: { html: string; templateId: string }): TemplateQualityReport {
  const slotTargets = collectSlotTargetsFromHtmlString(args.html);
  const issues: TemplateQualityIssue[] = [];

  // ---- 1. 槽位下限 ----
  const missingRequiredSlots: string[] = [];
  for (const rule of REQUIRED_SLOT_RULES) {
    if (rule.test(slotTargets)) continue;
    missingRequiredSlots.push(rule.label);
    issues.push({
      code: "missing_required_slot",
      severity: "blocker",
      message: `缺少必需槽位：${rule.label}。该模板入库后 AI 无内容可填、用户无法就地编辑。`,
    });
  }

  // ---- 2. L2 残留区块（模板作者的演示内容） ----
  // 传入 HTML 而非可见文本：静态阶段拿不到渲染后的可见文本，但 demo 残留
  // （lorem ipsum / 作者人名 / 英文 SaaS 看板）在源码里同样出现，且都是 high 级，
  // 属于"进库前必须清掉"的硬伤。误伤面很小（模板里出现人名/看板本来就不该）。
  //
  // **图片类信号要排除**：`hero_asset_business_mismatch`（宇航员/太空图）同时注册在
  // 残留文本表和资产表里。对**已发布站点**它该阻断（实测：华曜光伏站首屏用太空图，
  // 与业务完全无关）；但对**模板入库**它只是"这张 demo 图该换成企业实拍"——
  // 换图是运营动作，不是模板结构有问题。同一个信号在不同的门上本来就该有不同的
  // 严重度，所以这里按 key 排除，交给下面的资产检查以 warning 处理。
  const assetFindings = detectAssetIssues(args.html, args.templateId);
  const assetPatternKeys = new Set(assetFindings.map((finding) => finding.patternKey));
  for (const finding of detectResidualBlocks(args.html)) {
    if (assetPatternKeys.has(finding.patternKey)) continue;
    issues.push({
      code: `residual_${finding.patternKey}`,
      severity: finding.severity === "high" ? "blocker" : "warning",
      message: `模板残留演示内容：${finding.description}（命中：${finding.evidence.slice(0, 60)}）`,
    });
  }

  // ---- 3. 资产问题 ----
  for (const finding of assetFindings) {
    issues.push({
      code: `asset_${finding.patternKey}`,
      // 资产问题**不阻断入库**：它多半是"该换图"而不是"模板结构有问题"，
      // 换图是运营动作，不该卡住模板沉淀本身。
      severity: "warning",
      message: `资产：${finding.description}（命中：${finding.evidence.slice(0, 60)}）`,
    });
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker").map((issue) => issue.message);
  const warnings = issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);

  return {
    passed: blockers.length === 0,
    slotTargets,
    missingRequiredSlots,
    issues,
    blockers,
    warnings,
  };
}
