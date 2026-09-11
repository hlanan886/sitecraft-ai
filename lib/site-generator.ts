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
import type { SelfEvalIssue } from "./ai-self-eval.ts";
import { deriveDesignTokens } from "./design-variants.ts";
import { GENERATION_BUDGET, getRemainingBudget, getRemainingStageTimeout, hasFallbackBudget } from "./generation-budget.ts";
import { templateCatalog } from "./template-catalog.ts";
import { buildTemplateCapabilitySummary, type TemplateCapabilitySummary } from "./template-slot-guard.ts";
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
  maxAttempts?: number;
  deadlineAt?: number;
  capabilitySummary?: TemplateCapabilitySummary;
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
  let sections = core.filter((s) => !hidden.has(s));
  // 内容站（portfolio/blog 模板）：coreSections 仍可能含企业 5 段，但按该模板站点形态
  // 只生成实际承载的板块（个人作品集=about+features(作品)+contact；博客=about+features(文章)），
  // 避免对模板本没有的板块催内容。baseDraft.siteModel 同步标记，渲染层据此用列表语义。
  const template = templateCatalog.find((t) => t.id === templateId);
  const shape = template?.shape;
  if (shape === "portfolio") {
    baseDraft.siteModel = "portfolio";
    const portfolioSections = ["about", "features", "contact"];
    sections = portfolioSections.filter((s) => core.includes(s) || true).filter((s) => !hidden.has(s));
  } else if (shape === "blog") {
    baseDraft.siteModel = "blog";
    const blogSections = ["about", "features"];
    sections = blogSections.filter((s) => !hidden.has(s));
  }
  const hideOps: SiteOperation[] = [...new Set(hiddenSections)]
    .filter((s) => !sections.includes(s))
    .map((s) => ({
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

/** 从模板 presentation 提炼"每板块能装几条、什么形态"的容量提示，替换写死的"前3张卡片"。 */
export function buildPresentationCapacityText(capabilitySummary: TemplateCapabilitySummary, sections: string[]): string {
  const relevant = capabilitySummary.presentation.filter((p) => sections.includes(p.slot));
  if (!relevant.length) return "";
  return relevant
    .map((p) => `${p.slot}:${p.capacityDefault ? `约${p.capacityDefault}条` : ""}${p.capacityMax ? `(至多${p.capacityMax}条)` : ""}${p.hideUnlessFilled ? "，无可靠事实则该块隐藏" : ""}`)
    .join("；");
}

/** 站点形态对应的板块语义别名（提示词用），corporate 为默认企业语义。 */
export function siteModelSectionLabels(siteModel: "corporate" | "portfolio" | "blog") {
  if (siteModel === "portfolio") {
    return {
      slotText: "about(title/body 个人简介)、features(title/intro 及作品条目：每条一个代表作标题+一句成果说明)、contact(联系方式)。不要生成 services/products——作品集站没有服务/商品目录板块",
      navHint: "导航用：关于 / 作品 / 联系 三类即可",
    };
  }
  if (siteModel === "blog") {
    return {
      slotText: "about(title/body 站点简介)、features(title/intro 及文章条目：每条一篇文章标题+一句摘要)。不要生成 services/products/contact 企业板块——内容站只有简介+文章列表",
      navHint: "导航用：文章 / 关于 或站点名+分类 即可",
    };
  }
  return {
    slotText: "about(title/body)、features(title/intro 及条目)、services(title/intro 及条目)、products(title/intro)、contact(title/body)",
    navHint: "",
  };
}

/** 批 A 提示：骨架/首屏/元数据（必发）——按站点语言调整双语/单语；注入建站需求文档（B1 首稿质量） */
function batchAHint(intent: SiteIntent, siteLanguage: "zh" | "en", siteModel: "corporate" | "portfolio" | "blog" = "corporate"): string {
  const lang = siteLanguage === "en"
    ? "首屏与导航使用英文，中文可留'待补充'"
    : "首屏与导航使用中文（英文可留'待补充'）";
  const nav = siteModelSectionLabels(siteModel).navHint;
  return `复用已选模板结构。第一批只填充元数据与首屏——siteName、companyName、industry、goal、hero.title/subtitle/cta、navigation.*。${lang}。不要改其他板块。${nav ? nav + "。" : ""}\n\n${buildEnhancedIntentPrompt(intent)}`;
}

/** 批 B 提示：板块内容——按站点语言；用模板原生容量提示替代"前3张卡片"硬编码 */
function batchBHint(intent: SiteIntent, siteLanguage: "zh" | "en", capacityText: string, siteModel: "corporate" | "portfolio" | "blog" = "corporate"): string {
  const lang = siteLanguage === "en"
    ? "板块内容一律用英文书写"
    : "板块内容一律用中文书写";
  const capacityRule = capacityText
    ? `\n板块内容容量须贴合模板原生排版：${capacityText}。宁可按容量写少、写得实，不要为凑数空泛加卡。`
    : "每板块 2-4 条，宁少勿空。";
  const slotText = siteModelSectionLabels(siteModel).slotText;
  return `复用已选模板结构。第二批按板块填充内容——${slotText}。${lang}。不要为未列板块生成操作。${capacityRule}\n\n${buildEnhancedIntentPrompt(intent)}`;
}

export type GenerateDraftArgs = {
  intent: SiteIntent;
  templateId: string;
  hiddenSections: string[];
  siteLanguage?: "zh" | "en";
  draftOps: DraftOpsProvider;
  /** @deprecated 首稿自评已退出提交前关键路径；仅保留参数兼容旧调用。 */
  selfEval?: (args: { message: string; summary: string; operations: SiteOperation[]; templateId: string; signal?: AbortSignal }) => Promise<SelfEvalIssue[]>;
  onProgress?: (progress: GenerationProgress) => void;
  /** 上游取消信号，客户端断开或路由超时时会中止所有活跃任务。 */
  signal?: AbortSignal;
  /** 整次生成共用的绝对截止时间，fallback/recovery 不得重置。 */
  deadlineAt?: number;
  /** 单个主任务的硬截止；生产默认 25 秒，测试可注入短时间。 */
  taskTimeoutMs?: number;
  /** @deprecated 首稿自评已退出提交前关键路径。 */
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

const DEFAULT_TASK_TIMEOUT_MS = GENERATION_BUDGET.mainStageMs;
const DEFAULT_RECOVERY_TIMEOUT_MS = GENERATION_BUDGET.recoveryTaskMs;
const MIN_RECOVERY_TASK_BUDGET_MS = 2_000;
const MAX_RECOVERY_CONCURRENCY = 2;

function remainingBudgetMs(deadlineAt?: number): number {
  return getRemainingBudget(deadlineAt);
}

function boundedTimeoutMs(limitMs: number, deadlineAt?: number): number {
  return getRemainingStageTimeout({ deadlineAt, stageCapMs: limitMs });
}

function runDraftTask(
  draftOps: DraftOpsProvider,
  providerArgs: Parameters<DraftOpsProvider>[0],
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<DraftOpsResult> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: DraftOpsResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      resolve(result);
    };
    const onParentAbort = () => {
      controller.abort(parentSignal?.reason);
      finish({ ok: false, code: "aborted", error: "内容生成已取消" });
    };
    if (parentSignal?.aborted) {
      onParentAbort();
      return;
    }
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timer = setTimeout(() => {
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

function fastSkeletonOperations(intent: SiteIntent, siteLanguage: "zh" | "en"): SiteOperation[] {
  const locale = siteLanguage;
  const isEnglish = locale === "en";
  const companyName = intent.companyName.trim().slice(0, 120);
  const industry = intent.industry.trim().slice(0, 120);
  const summary = intent.summary.trim().slice(0, 180);
  return [
    { op: "set_text" as const, target: "siteName", locale, value: companyName },
    { op: "set_text" as const, target: "companyName", locale, value: companyName },
    { op: "set_text" as const, target: "industry", locale, value: industry },
    { op: "set_text" as const, target: "goal", locale, value: summary },
    { op: "set_text" as const, target: "hero.title", locale, value: companyName },
    { op: "set_text" as const, target: "hero.subtitle", locale, value: summary },
    { op: "set_text" as const, target: "hero.cta", locale, value: isEnglish ? "Request a quote" : "获取询盘" },
  ];
}

function operationCoversSection(operation: SiteOperation, section: string) {
  if (operation.op === "set_text") return operation.target.startsWith(`${section}.`);
  if (operation.op === "update_card" || operation.op === "add_card" || operation.op === "remove_card") return operation.section === section;
  return operation.op === "replace_products" && section === "products";
}

function ensureTemplateOperation(operations: SiteOperation[], templateId: string) {
  if (operations.some((operation) => operation.op === "set_template" && operation.templateId === templateId)) return operations;
  return [{ op: "set_template", templateId } satisfies SiteOperation, ...operations];
}

function buildFastFallbackOutcome(
  args: GenerateDraftArgs,
  plan: GenerationPlan,
  requestedTemplateId: string,
  appliedTemplateId: string,
  reason: string,
  extraOperations: SiteOperation[] = [],
): GenerateDraftOutcome {
  const missingSections = plan.scope.sections.filter(
    (section) => !extraOperations.some((operation) => operationCoversSection(operation, section)),
  );
  const validated = validateGenerationOperations(
    ensureTemplateOperation(
      [...plan.leadingOps, ...fastSkeletonOperations(args.intent, plan.scope.siteLanguage), ...extraOperations, ...plan.hideOps],
      appliedTemplateId,
    ),
    new Set(templateCatalog.map((template) => template.id)),
  );
  return {
    ok: true,
    summary: "模型响应较慢，已先保存公司信息与首屏初稿，其余板块待补全。",
    operations: validated.operations,
    model: "local-fast-fallback",
    selfEvalIssues: [],
    completedSections: ["hero"],
    partial: true,
    missingSections,
    requestedTemplateId,
    appliedTemplateId,
    templateFallbackReason: reason,
  };
}

/** 为现有模板生成内容：批 A/B 并行 → 合并确定性校验 → 单次提交。 */
export async function generateDraftOperations(args: GenerateDraftArgs): Promise<GenerateDraftOutcome> {
  if (args.signal?.aborted) return { ok: false, code: "aborted", error: "内容生成已取消" };
  if (remainingBudgetMs(args.deadlineAt) <= 0) return { ok: false, code: "timeout", error: "内容生成超时" };
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
  const initialTaskTimeoutMs = boundedTimeoutMs(taskTimeoutMs, args.deadlineAt);
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
      attemptHint: batchAHint(args.intent, lang, plan.baseDraft.siteModel),
      deadlineAt: args.deadlineAt,
      capabilitySummary: buildTemplateCapabilitySummary(appliedTemplateId, lang),
    }, initialTaskTimeoutMs, args.signal).then((result) => {
      if (result.ok) completedSections.add("hero"); else failedSections.add("hero");
      reportProgress("content", result.ok ? "首屏内容已完成，正在填充其余板块…" : "首屏内容生成失败");
      return result;
    });
  const batchBSummary = buildTemplateCapabilitySummary(appliedTemplateId, lang);
  const batchBCapacityText = buildPresentationCapacityText(batchBSummary, plan.scope.sections);
  const batchBPromise = runDraftTask(args.draftOps, {
        intent: args.intent,
        templateId: appliedTemplateId,
        baseDraft: plan.baseDraft,
        scope: { sections: plan.scope.sections, bilingual: false, siteLanguage: lang },
        attemptHint: batchBHint(args.intent, lang, batchBCapacityText, plan.baseDraft.siteModel),
        deadlineAt: args.deadlineAt,
        capabilitySummary: batchBSummary,
      }, initialTaskTimeoutMs, args.signal).then((result) => {
      if (result.ok) plan.scope.sections.forEach((section) => completedSections.add(section));
      reportProgress("content", result.ok ? "板块内容已完成，正在等待首屏并合并…" : "整批内容未完成，正在逐板块恢复…");
      return result;
    });
  const [batchA, initialBatchB] = await Promise.all([batchAPromise, batchBPromise]);
  if (!batchA.ok) {
    if (appliedTemplateId !== "forge" && !args.signal?.aborted && hasFallbackBudget(remainingBudgetMs(args.deadlineAt))) {
      reportProgress("content", `模板 ${appliedTemplateId} 生成异常，正在切换兼容模板…`);
      const fallback = await generateDraftOperations({ ...args, templateId: "forge" });
      if (fallback.ok) {
        return {
          ...fallback,
          operations: ensureTemplateOperation(fallback.operations, "forge"),
          requestedTemplateId,
          templateFallbackReason: `模板 ${appliedTemplateId} 生成异常，已切换到兼容模板 forge`,
        };
      }
      if (fallback.code === "aborted" || args.signal?.aborted) return fallback;
      return buildFastFallbackOutcome(
        args,
        buildGenerationPlan(args.intent, "forge", args.hiddenSections, args.siteLanguage),
        requestedTemplateId,
        "forge",
        `模板 ${appliedTemplateId} 与兼容模板均未在时限内响应，已保存快速初稿。`,
        initialBatchB.ok ? initialBatchB.operations : [],
      );
    }
    if (args.signal?.aborted) return { ok: false, code: "aborted", error: "内容生成已取消" };
    if (appliedTemplateId === "forge") {
      return buildFastFallbackOutcome(
        args,
        plan,
        requestedTemplateId,
        appliedTemplateId,
        "模型响应较慢，已保存快速初稿，其余板块待补全。",
        initialBatchB.ok ? initialBatchB.operations : [],
      );
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
    const recoveryDeadlineAt = Math.min(
      args.deadlineAt ?? Number.POSITIVE_INFINITY,
      Date.now() + GENERATION_BUDGET.recoveryWindowMs,
    );
    const recovered: DraftOpsResult[] = new Array(plan.scope.sections.length);
    let nextRecoveryIndex = 0;
    const recoverNext = async () => {
      while (nextRecoveryIndex < plan.scope.sections.length) {
        const index = nextRecoveryIndex;
        nextRecoveryIndex += 1;
        const section = plan.scope.sections[index];
        let result: DraftOpsResult;
        if (args.signal?.aborted || remainingBudgetMs(recoveryDeadlineAt) < MIN_RECOVERY_TASK_BUDGET_MS) {
          result = { ok: false, code: args.signal?.aborted ? "aborted" : "timeout", error: args.signal?.aborted ? "内容生成已取消" : "剩余时间不足" };
        } else {
          const recoveryTimeoutMs = boundedTimeoutMs(Math.min(taskTimeoutMs, DEFAULT_RECOVERY_TIMEOUT_MS), recoveryDeadlineAt);
          result = await runDraftTask(args.draftOps, {
            intent: args.intent,
            templateId: appliedTemplateId,
            baseDraft: plan.baseDraft,
            scope: { sections: [section], bilingual: false, siteLanguage: lang },
            attemptHint: `${batchBHint(args.intent, lang, buildPresentationCapacityText(buildTemplateCapabilitySummary(appliedTemplateId, lang), [section]), plan.baseDraft.siteModel)}\n\n恢复模式：只生成 ${section} 板块，其他板块不要产生操作。`,
            maxAttempts: 1,
            deadlineAt: recoveryDeadlineAt,
            capabilitySummary: buildTemplateCapabilitySummary(appliedTemplateId, lang),
          }, recoveryTimeoutMs, args.signal);
        }
        recovered[index] = result;
        recoveringSections.delete(section);
        if (result.ok) completedSections.add(section); else failedSections.add(section);
        reportProgress("content", result.ok ? `${section} 板块已恢复` : `${section} 板块暂未完成，稍后可补全`);
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(MAX_RECOVERY_CONCURRENCY, plan.scope.sections.length) },
      () => recoverNext(),
    ));
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
  reportProgress("review", "内容已生成，正在核对板块、语言与可编辑字段…");
  return {
    ok: true,
    summary,
    operations: validated.operations,
    model,
    selfEvalIssues: [],
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
  signal?: AbortSignal;
  deadlineAt?: number;
  taskTimeoutMs?: number;
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

function operationBelongsToSection(operation: SiteOperation, section: "hero" | SectionKey) {
  if (operation.op === "set_text") return operation.target.startsWith(`${section}.`);
  if (operation.op === "update_card" || operation.op === "add_card" || operation.op === "remove_card") {
    return operation.section === section;
  }
  if (operation.op === "replace_products") return section === "products";
  return false;
}

/**
 * 局部重生成：只对目标板块生成定向操作，其余板块零操作（借鉴 replace_section_in_page 的 preserved_sections 语义）。
 * 基于当前草稿（baseDraft），不是从默认草稿从零写——模型看到现状再改。
 */
export async function regenerateSectionOperations(args: RegenerateSectionArgs): Promise<RegenerateOutcome> {
  if (args.signal?.aborted) return { ok: false, code: "aborted", error: "局部生成已取消" };
  const timeoutMs = boundedTimeoutMs(args.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS, args.deadlineAt);
  if (timeoutMs <= 0) return { ok: false, code: "timeout", error: "局部生成超时" };
  const lang = args.siteLanguage ?? "zh";
  const hint = regenerateSectionHint(args.section, args.direction, args.mode ?? "text", lang);
  const result = await runDraftTask(args.draftOps, {
    intent: args.intent,
    templateId: args.templateId,
    baseDraft: args.baseDraft,
    scope: { sections: [args.section], bilingual: false, siteLanguage: lang },
    attemptHint: hint,
    deadlineAt: args.deadlineAt,
    capabilitySummary: buildTemplateCapabilitySummary(args.templateId, lang),
  }, timeoutMs, args.signal);
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }
  // 校验（白名单 + 长度，与生成场景一致）
  const templateIds = new Set(templateCatalog.map((t) => t.id));
  const validated = validateGenerationOperations(result.operations, templateIds);
  return {
    ok: true,
    summary: result.summary,
    operations: validated.operations.filter((operation) => operationBelongsToSection(operation, args.section)),
    model: result.model,
    selfEvalIssues: [],
    completedSections: [args.section],
    partial: false,
    missingSections: [],
  };
}

export type RegenerateMissingSectionsArgs = {
  intent: SiteIntent;
  templateId: string;
  baseDraft: SiteDraft;
  sections: SectionKey[];
  siteLanguage?: "zh" | "en";
  draftOps: DraftOpsProvider;
  signal?: AbortSignal;
  deadlineAt?: number;
  taskTimeoutMs?: number;
};

export type RegenerateMissingSectionsOutcome =
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; selfEvalIssues: SelfEvalIssue[]; completedSections: SectionKey[]; partial: boolean; missingSections: SectionKey[] }
  | { ok: false; code: string; error: string };

/** 多板块补全共享同一绝对截止时间；成功操作只合并返回一次，由 route 单次提交。 */
export async function regenerateMissingSectionsOperations(
  args: RegenerateMissingSectionsArgs,
): Promise<RegenerateMissingSectionsOutcome> {
  const sections = [...new Set(args.sections)];
  if (!sections.length) return { ok: false, code: "invalid_scope", error: "没有需要补全的板块" };
  if (args.signal?.aborted) return { ok: false, code: "aborted", error: "补全已取消" };
  if (remainingBudgetMs(args.deadlineAt) <= 0) return { ok: false, code: "timeout", error: "补全已超时" };

  const results: Array<{ section: SectionKey; outcome: RegenerateOutcome }> = new Array(sections.length);
  let nextIndex = 0;
  const runNext = async () => {
    while (nextIndex < sections.length) {
      const index = nextIndex;
      nextIndex += 1;
      const section = sections[index];
      const outcome = await regenerateSectionOperations({
        intent: args.intent,
        templateId: args.templateId,
        baseDraft: args.baseDraft,
        section,
        direction: "只补全缺失内容，保留已有内容",
        mode: "text",
        siteLanguage: args.siteLanguage,
        draftOps: args.draftOps,
        signal: args.signal,
        deadlineAt: args.deadlineAt,
        taskTimeoutMs: args.taskTimeoutMs,
      });
      results[index] = { section, outcome };
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_RECOVERY_CONCURRENCY, sections.length) }, () => runNext()));
  const completed = results.filter((item) => item.outcome.ok);
  if (!completed.length) {
    const firstFailure = results[0].outcome;
    return firstFailure.ok
      ? { ok: false, code: "no_change", error: "缺失板块没有产生可保存内容" }
      : { ok: false, code: firstFailure.code, error: firstFailure.error };
  }
  const missingSections = results.filter((item) => !item.outcome.ok).map((item) => item.section);
  const successfulOutcomes = completed.map((item) => item.outcome).filter((outcome): outcome is Extract<RegenerateOutcome, { ok: true }> => outcome.ok);
  return {
    ok: true,
    summary: successfulOutcomes.map((outcome) => outcome.summary).join("；"),
    operations: successfulOutcomes.flatMap((outcome) => outcome.operations),
    model: successfulOutcomes.at(-1)?.model ?? "",
    selfEvalIssues: [],
    completedSections: completed.map((item) => item.section),
    partial: missingSections.length > 0,
    missingSections,
  };
}
