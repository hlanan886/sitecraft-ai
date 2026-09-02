/**
 * 一句话建站 · 生成编排模块
 *
 * 纯逻辑 + 依赖注入（DraftOpsProvider），只用相对导入（可被 npm test 直接测，不触网）。
 * 职责：根据意图 + 模板，编排"模板默认草稿 + 结构化操作"生成整站初稿。
 *
 * 设计（方案 A）：baseDraft = cloneDraft(defaultDraft)；templateId≠forge 时 leadingOps 含 set_template；
 * 分批 A（骨架/首屏/元数据）→ 批 B（板块内容，按 coreSections）；合并后单次 commit，可撤销。
 */

import { cloneDraft, defaultDraft, type SectionKey, type SiteDraft } from "./site-document.ts";
import { validateGenerationOperations, type SiteOperation } from "./site-operations.ts";
import { evaluateOperations, shouldSelfEvaluate, type SelfEvalIssue } from "./ai-self-eval.ts";
import { deriveDesignTokens } from "./design-variants.ts";
import { templateCatalog } from "./template-catalog.ts";
import type { SiteIntent } from "./site-intent.ts";

export type GenerationScope = { sections: string[]; bilingual: boolean; siteLanguage: "zh" | "en" };

export type DraftOpsResult =
  | { ok: true; summary: string; operations: SiteOperation[]; model: string }
  | { ok: false; code: string; error: string };

/** 依赖注入的 AI 调用（route 层把 requestDraftOperations 包进来；测试注入 mock） */
export type DraftOpsProvider = (args: {
  intent: SiteIntent;
  templateId: string;
  baseDraft: SiteDraft;
  scope: GenerationScope;
  attemptHint?: string;
  signal?: AbortSignal;
}) => Promise<DraftOpsResult>;

export type GenerationPlan = {
  baseDraft: SiteDraft;
  leadingOps: SiteOperation[];
  scope: GenerationScope;
  hideOps: SiteOperation[];
};

/** 编排计划：克隆默认草稿、生成 set_template 前置、确定生成板块、生成隐藏操作 */
export function buildGenerationPlan(
  intent: SiteIntent,
  templateId: string,
  hiddenSections: string[],
  siteLanguage: "zh" | "en" = "zh",
): GenerationPlan {
  const baseDraft = cloneDraft(defaultDraft);
  const leadingOps: SiteOperation[] = [
    ...(templateId !== "forge" ? [{ op: "set_template" as const, templateId }] : []),
    { op: "set_design_tokens", tokens: deriveDesignTokens(intent, templateId) },
  ];
  const core = intent.coreSections as string[];
  const hidden = new Set(hiddenSections);
  const sections = core.filter((s) => !hidden.has(s));
  const hideOps: SiteOperation[] = hiddenSections.map((s) => ({
    op: "set_section_visibility",
    section: s as "about" | "features" | "services" | "products" | "contact",
    visible: false,
  }));
  return { baseDraft, leadingOps, scope: { sections, bilingual: true, siteLanguage }, hideOps };
}

/** 意图 → 建站需求文档（B1 首稿质量：把意图字段本地拼接成结构化需求，塞进生成 hint，零额外 LLM 调用） */
export function buildEnhancedIntentPrompt(intent: SiteIntent): string {
  const businessLabel: Record<string, string> = {
    manufacturing: "工业制造",
    trade: "外贸",
    tech: "科技",
    services: "专业服务",
    other: "其他",
  };
  const audienceLabel: Record<string, string> = {
    overseasB2b: "海外企业客户",
    domesticB2b: "国内企业客户",
    globalB2b: "全球企业客户",
    endUsers: "终端用户",
    investorsPartners: "投资人/合作伙伴",
    other: "其他",
  };
  const toneLabel: Record<string, string> = {
    professional: "专业可靠",
    technical: "技术硬核",
    friendly: "亲切友好",
    bold: "大胆有冲击力",
    minimal: "极简克制",
    editorial: "编辑式/有观点",
  };
  const colorLabel: Record<string, string> = {
    green: "绿色系（自然/工业）",
    navy: "藏蓝系（稳重/全球贸易）",
    purple: "紫色系（科技/创意）",
    dark: "深色系（高端/极客）",
    warm: "暖色系（亲和/专业服务）",
    neutral: "中性色（极简/通用）",
  };
  const parts = [
    `【建站需求】业务类型：${businessLabel[intent.businessType] ?? intent.businessType}`,
    `公司/品牌：${intent.companyName}`,
    `行业：${intent.industry}`,
    `目标受众：${audienceLabel[intent.targetAudience] ?? intent.targetAudience}`,
    `语气风格：${toneLabel[intent.tone] ?? intent.tone}`,
  ];
  if (intent.colorTone) parts.push(`色系：${colorLabel[intent.colorTone] ?? intent.colorTone}`);
  parts.push(`核心板块：${intent.coreSections.join("、")}`);
  parts.push(`站点概述：${intent.summary}`);
  return parts.join("\n");
}

/** 批 A 提示：骨架/首屏/元数据（必发）——按站点语言调整双语/单语；注入建站需求文档（B1 首稿质量） */
function batchAHint(intent: SiteIntent, siteLanguage: "zh" | "en"): string {
  const lang = siteLanguage === "en"
    ? "首屏与导航使用英文，中文可留'待补充'"
    : "首屏与导航使用中文（英文可留'待补充'）";
  return `复用已选模板结构。第一批只填充元数据与首屏——siteName、companyName、industry、goal、hero.title/subtitle/cta、navigation.*。${lang}。不要改其他板块。\n\n${buildEnhancedIntentPrompt(intent)}`;
}

/** 批 B 提示：板块内容——按站点语言，中英站点都写对应语言；注入建站需求文档（B1 首稿质量） */
function batchBHint(intent: SiteIntent, siteLanguage: "zh" | "en"): string {
  const lang = siteLanguage === "en"
    ? "板块内容一律用英文书写"
    : "板块内容一律用中文书写";
  return `复用已选模板结构。第二批按板块填充内容——about(title/body)、features(title/intro 及前 3 张卡片)、services(title/intro 及前 3 张卡片)、products(title/intro)、contact(title/body)。${lang}。不要为未列板块生成操作。\n\n${buildEnhancedIntentPrompt(intent)}`;
}

export type GenerateDraftArgs = {
  intent: SiteIntent;
  templateId: string;
  hiddenSections: string[];
  siteLanguage?: "zh" | "en";
  draftOps: DraftOpsProvider;
  /** B2 首稿自评注入（默认走真实 evaluateOperations；测试注入 mock 保不触网） */
  selfEval?: (args: { message: string; summary: string; operations: SiteOperation[]; templateId: string }) => Promise<SelfEvalIssue[]>;
  onProgress?: (progress: GenerationProgress) => void;
  /** 单个主任务的硬截止；生产默认 25 秒，测试可注入短时间。 */
  taskTimeoutMs?: number;
  /** 自评属于增强项，超时后直接放行。 */
  selfEvalTimeoutMs?: number;
};

export type GenerationProgress = {
  phase: "content" | "review";
  message: string;
  completedSections: string[];
  activeSections: string[];
  recoveringSections: string[];
  failedSections: string[];
};

export type GenerateDraftOutcome =
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; selfEvalIssues: SelfEvalIssue[]; completedSections: string[]; partial: boolean; missingSections: string[]; requestedTemplateId: string; appliedTemplateId: string; templateFallbackReason?: string }
  | { ok: false; code: string; error: string };

const DEFAULT_TASK_TIMEOUT_MS = 25_000;
const DEFAULT_RECOVERY_TIMEOUT_MS = 8_000;
const DEFAULT_SELF_EVAL_TIMEOUT_MS = 6_000;

function runDraftTask(
  draftOps: DraftOpsProvider,
  providerArgs: Parameters<DraftOpsProvider>[0],
  timeoutMs: number,
): Promise<DraftOpsResult> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DraftOpsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      controller.abort(new Error("内容生成超时"));
      finish({ ok: false, code: "timeout", error: "内容生成超时" });
    }, Math.max(1, timeoutMs));
    Promise.resolve()
      .then(() => draftOps({ ...providerArgs, signal: controller.signal }))
      .then(finish, (error: unknown) => finish({
        ok: false,
        code: "provider_error",
        error: error instanceof Error ? error.message : "内容生成失败",
      }));
  });
}

function runWithDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), Math.max(1, timeoutMs));
    task.then((value) => finish(value), () => finish(undefined));
  });
}

/** 为现有模板生成内容：批 A/B 并行 → 合并校验 → 首稿自评 → 单次提交。 */
export async function generateDraftOperations(args: GenerateDraftArgs): Promise<GenerateDraftOutcome> {
  const requestedTemplateId = args.templateId;
  const appliedTemplateId = templateCatalog.some((template) => template.id === requestedTemplateId) ? requestedTemplateId : "forge";
  const templateFallbackReason = appliedTemplateId === requestedTemplateId ? undefined : `模板 ${requestedTemplateId} 不可用，已回退到 forge`;
  const plan = buildGenerationPlan(args.intent, appliedTemplateId, args.hiddenSections, args.siteLanguage);
  const lang = plan.scope.siteLanguage;
  // 两批只读取同一模板草稿且目标字段互不重叠，可并行缩短等待时间；合并后仍只提交一次。
  const completedSections = new Set<string>();
  const recoveringSections = new Set<string>();
  const failedSections = new Set<string>();
  const taskTimeoutMs = args.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const reportProgress = (phase: GenerationProgress["phase"], message: string) => {
    const allSections = ["hero", ...plan.scope.sections];
    args.onProgress?.({
      phase,
      message,
      completedSections: allSections.filter((section) => completedSections.has(section)),
      activeSections: phase === "content" ? allSections.filter((section) => !completedSections.has(section) && !recoveringSections.has(section) && !failedSections.has(section)) : [],
      recoveringSections: allSections.filter((section) => recoveringSections.has(section)),
      failedSections: allSections.filter((section) => failedSections.has(section)),
    });
  };
  const batchAPromise = runDraftTask(args.draftOps, {
      intent: args.intent,
      templateId: appliedTemplateId,
      baseDraft: plan.baseDraft,
      scope: { sections: plan.scope.sections, bilingual: true, siteLanguage: lang },
      attemptHint: batchAHint(args.intent, lang),
    }, taskTimeoutMs).then((result) => {
      if (result.ok) completedSections.add("hero"); else failedSections.add("hero");
      reportProgress("content", result.ok ? "首屏内容已完成，正在填充其余板块…" : "首屏内容生成失败");
      return result;
    });
  const batchBPromise = runDraftTask(args.draftOps, {
        intent: args.intent,
        templateId: appliedTemplateId,
        baseDraft: plan.baseDraft,
        scope: { sections: plan.scope.sections, bilingual: false, siteLanguage: lang },
        attemptHint: batchBHint(args.intent, lang),
      }, taskTimeoutMs).then((result) => {
      if (result.ok) plan.scope.sections.forEach((section) => completedSections.add(section));
      reportProgress("content", result.ok ? "板块内容已完成，正在等待首屏并合并…" : "整批内容未完成，正在逐板块恢复…");
      return result;
    });
  const [batchA, initialBatchB] = await Promise.all([batchAPromise, batchBPromise]);
  if (!batchA.ok) {
    if (appliedTemplateId !== "forge") {
      reportProgress("content", `模板 ${appliedTemplateId} 生成异常，正在切换兼容模板…`);
      const fallback = await generateDraftOperations({ ...args, templateId: "forge" });
      if (fallback.ok) {
        return {
          ...fallback,
          requestedTemplateId,
          templateFallbackReason: `模板 ${appliedTemplateId} 生成异常，已切换到兼容模板 forge`,
        };
      }
    }
    return { ok: false, code: batchA.code, error: batchA.error };
  }
  failedSections.delete("hero");
  let ops: SiteOperation[] = [...plan.leadingOps, ...batchA.operations];
  let summary = batchA.summary;
  let model = batchA.model;

  if (initialBatchB.ok) {
    ops = [...ops, ...initialBatchB.operations];
    summary = `${summary}；${initialBatchB.summary}`;
    model = initialBatchB.model;
  } else {
    plan.scope.sections.forEach((section) => recoveringSections.add(section));
    reportProgress("content", "正在隔离异常板块，已完成内容会先保留");
    const recoveryTimeoutMs = Math.min(taskTimeoutMs, DEFAULT_RECOVERY_TIMEOUT_MS);
    const recovered = await Promise.all(plan.scope.sections.map(async (section) => {
      const result = await runDraftTask(args.draftOps, {
        intent: args.intent,
        templateId: appliedTemplateId,
        baseDraft: plan.baseDraft,
        scope: { sections: [section], bilingual: false, siteLanguage: lang },
        attemptHint: `${batchBHint(args.intent, lang)}\n\n恢复模式：只生成 ${section} 板块，其他板块不要产生操作。`,
      }, recoveryTimeoutMs);
      recoveringSections.delete(section);
      if (result.ok) completedSections.add(section); else failedSections.add(section);
      reportProgress("content", result.ok ? `${section} 板块已恢复` : `${section} 板块暂未完成，稍后可补全`);
      return result;
    }));
    for (const result of recovered) {
      if (!result.ok) continue;
      ops.push(...result.operations);
      summary = `${summary}；${result.summary}`;
      model = result.model;
    }
  }
  // 合并隐藏操作
  ops = [...ops, ...plan.hideOps];

  // 校验（白名单 + 长度，生成场景专用：set_template 只查白名单，不要求"明确换模板"）
  const templateIds = new Set(templateCatalog.map((t) => t.id));
  const validated = validateGenerationOperations(ops, templateIds);
  reportProgress("review", "内容已生成，AI 正在质检（查证事实、核对板块与语言）…");

  // B2 首稿自评（仅首稿；fail-open——自评失败/异常不阻塞生成，issues 并入返回供确认页提示）
  let selfEvalIssues: SelfEvalIssue[] = [];
  if (shouldSelfEvaluate(validated.operations)) {
    const runSelfEval = args.selfEval ?? (async (evalArgs) => {
      const r = await evaluateOperations({
        message: evalArgs.message,
        summary: evalArgs.summary,
        operations: evalArgs.operations,
        templateId: evalArgs.templateId,
      });
      return r.issues;
    });
    try {
      selfEvalIssues = (await runWithDeadline(runSelfEval({
        message: args.intent.summary,
        summary,
        operations: validated.operations,
        templateId: appliedTemplateId,
      }), args.selfEvalTimeoutMs ?? DEFAULT_SELF_EVAL_TIMEOUT_MS)) ?? [];
    } catch {
      selfEvalIssues = []; // fail-open：自评异常不影响生成
    }
  }
  return {
    ok: true,
    summary,
    operations: validated.operations,
    model,
    selfEvalIssues,
    completedSections: ["hero", ...plan.scope.sections].filter((section) => completedSections.has(section)),
    // P0-2 假成功修复：批 B（板块内容）失败时明确标记 partial，前端提示"板块未完整生成，可让 AI 补全"，
    // 避免用户看到默认模板的 Forge 演示文案却以为生成成功。
    partial: failedSections.size > 0,
    missingSections: plan.scope.sections.filter((section) => failedSections.has(section)),
    requestedTemplateId,
    appliedTemplateId,
    ...(templateFallbackReason ? { templateFallbackReason } : {}),
  };
}

// ===== C 块：局部重生成（板块级） =====

/** 局部重生成模式：text 只重写文本字段（保守）；all 允许结构微调（卡片增删，受视觉护栏约束） */
export type RegenerateMode = "text" | "all";

export type RegenerateSectionArgs = {
  intent: SiteIntent;
  templateId: string;
  /** 当前草稿（重生成基于现状，不是从默认草稿从零写） */
  baseDraft: SiteDraft;
  /** 目标板块：hero 或 sectionKey */
  section: "hero" | SectionKey;
  /** 用户想改的方向（可空，空则按模板默认风格重写） */
  direction?: string;
  /** text=只重写文本；all=允许卡片增删（受 visualRules 约束） */
  mode?: RegenerateMode;
  siteLanguage?: "zh" | "en";
  draftOps: DraftOpsProvider;
};

export type RegenerateOutcome =
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; selfEvalIssues: SelfEvalIssue[]; completedSections: string[]; partial: false; missingSections: [] }
  | { ok: false; code: string; error: string };

/** 板块重生成 hint：只改目标板块 + 视觉一致性护栏（借鉴 replace_section_in_page 的 preserve_design_tokens）+ 可选方向 */
function regenerateSectionHint(section: "hero" | SectionKey, direction: string | undefined, mode: RegenerateMode, siteLanguage: "zh" | "en"): string {
  const lang = siteLanguage === "en" ? "内容用英文书写" : "内容用中文书写";
  const directionText = direction?.trim() ? `用户想改的方向：${direction.trim()}。` : "用户未指定方向，按模板默认风格重写。";
  const scopeText = section === "hero"
    ? "hero.title、hero.subtitle、hero.cta"
    : `${section}.title、${section}.intro（及该板块卡片）`;
  const structureRule = mode === "all"
    ? "允许增删该板块的卡片（保持模板的信息密度与风格）"
    : "保持现有卡片数量不变，只重写文本内容";
  return `只重生成 ${section} 板块——${scopeText}。${directionText}${structureRule}。${lang}。
视觉护栏：必须保持当前模板的配色、字体、栅格与整体风格（preserve design tokens），不得引入与模板冲突的样式；缺失的企业事实写"待补充"，不虚构。`;
}

/**
 * 局部重生成：只对目标板块生成定向操作，其余板块零操作（借鉴 replace_section_in_page 的 preserved_sections 语义）。
 * 基于当前草稿（baseDraft），不是从默认草稿从零写——模型看到现状再改。
 */
export async function regenerateSectionOperations(args: RegenerateSectionArgs): Promise<RegenerateOutcome> {
  const lang = args.siteLanguage ?? "zh";
  const hint = regenerateSectionHint(args.section, args.direction, args.mode ?? "text", lang);
  const result = await args.draftOps({
    intent: args.intent,
    templateId: args.templateId,
    baseDraft: args.baseDraft,
    scope: { sections: [args.section], bilingual: false, siteLanguage: lang },
    attemptHint: hint,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }
  // 校验（白名单 + 长度，与生成场景一致）
  const templateIds = new Set(templateCatalog.map((t) => t.id));
  const validated = validateGenerationOperations(result.operations, templateIds);
  return { ok: true, summary: result.summary, operations: validated.operations, model: result.model, selfEvalIssues: [], completedSections: [args.section], partial: false, missingSections: [] };
}
