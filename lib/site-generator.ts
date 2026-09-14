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
import { GENERATION_BUDGET, getRemainingBudget, getRemainingStageTimeout, hasFallbackBudget } from "./generation-budget.ts";
import { templateCatalog } from "./template-catalog.ts";
import { allTemplates } from "./site-model.ts";
import { buildTemplateCapabilitySummary, type TemplateCapabilitySummary } from "./template-slot-guard.ts";
import { getTemplatePresentation } from "./template-manifest.ts";
import { SLOT_MAX_LENGTH } from "./template-slot-contract.ts";
import { appendGenerationTrace, createTraceRunId, reconcileSectionUnderstanding, type SectionAwarenessDeclaration, type SectionUnderstandingReport, type TraceBatchId } from "./generation-trace.ts";
import { adaptiveTimeoutMs, planSectionGroups, recordLatency, type SectionGroup } from "./generation-reliability.ts";
import type { SiteIntent } from "./site-intent.ts";

export type GenerationScope = { sections: string[]; bilingual: boolean; siteLanguage: "zh" | "en" };

export type DraftOpsResult =
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; awareness?: SectionAwarenessDeclaration[] }
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
  /** P0 过程痕迹：透传给 ai-provider 记录 model.request/response。 */
  traceCtx?: { runId: string; batch: TraceBatchId; attempt?: number };
}) => Promise<DraftOpsResult>;

export type GenerationPlan = {
  baseDraft: SiteDraft;
  leadingOps: SiteOperation[];
  scope: GenerationScope;
  hideOps: SiteOperation[];
};

/**
 * 编排计划：克隆默认草稿、生成 set_template 前置、确定生成板块、生成隐藏操作
 *
 * 2026-09-09 产品决策：**不再生成 `set_design_tokens`**。
 * 原因同 lib/design-variants.ts 文件头（配色取模板自带值）——字体/圆角/区块间距同理。
 * 此前每次生成都无条件下发 tokens，预览层用 `!important` 覆盖
 * `body{font-family}` / `[class*=card]{border-radius}` / `main>section{padding}`，
 * 导致 22/22 模板的设计特征被抹平，用户看到的是「换皮」而非选中的模板。
 * 模板专属兜底样式由 adapter.designTokenCss 承担（见 preview 路由的 applyDesignTokens），
 * 与用户是否设置 tokens 无关，因此无需 tokens 也能保证生成区观感正确。
 */
export function buildGenerationPlan(
  intent: SiteIntent,
  templateId: string,
  hiddenSections: string[],
  siteLanguage: "zh" | "en" = "zh",
  /**
   * 站点当前是否已有商品（2026-09-10）。
   *
   * `products` 在模板契约里是 `required: true`（`contentSlots()` 把 10 个槽位硬编码为必填），
   * 而生成链路**写不出商品**（`replace_products` 不在任何生成 scope 的白名单里），
   * `defaultDraft.products` 也已不再预置演示商品。三者叠加 →
   * **新站生成后商品为空 → 发布被 422 拦下**。
   *
   * 语义：无商品则**隐藏产品板块**（而不是让 AI 编造，也不是强制用户先导入）。
   * 因为 `products` 是**模板级必填**、不是**业务级必填**——政府站/律所本就没有产品目录。
   * 用户导入商品后 `replace_products` 会重建该节，预览自然恢复。
   *
   * 默认 `true` 保持既有纯函数调用行为不变；生产由 route 传站点真实状态。
   */
  hasProducts = true,
): GenerationPlan {
  const baseDraft = cloneDraft(defaultDraft);
  const leadingOps: SiteOperation[] = [
    ...(templateId !== "forge" ? [{ op: "set_template" as const, templateId }] : []),
  ];
  const core = intent.coreSections as string[];
  const hidden = new Set(hiddenSections);
  // 没有商品 → 隐藏产品板块（见 hasProducts 参数注释）
  if (!hasProducts) hidden.add("products");
  let sections = core.filter((s) => !hidden.has(s));
  // 内容站（portfolio/blog 模板）：coreSections 仍可能含企业 5 段，但按该模板站点形态
  // 只生成实际承载的板块（个人作品集=about+features(作品)+contact；博客=about+features(文章)），
  // 避免对模板本没有的板块催内容。baseDraft.siteModel 同步标记，渲染层据此用列表语义。
  const template = allTemplates().find((t) => t.id === templateId);
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
  // 用 `hidden` 集合（含"无商品则隐藏 products"的推导结果），而不是原始参数数组——
  // 否则该推导只影响 sections 过滤，产不出对应的 hideOps，草稿上仍是显示状态。
  const hideOps: SiteOperation[] = [...hidden]
    .filter((s) => !sections.includes(s))
    .map((s) => ({
      op: "set_section_visibility",
      section: s as "about" | "features" | "services" | "products" | "contact",
      visible: false,
    }));
  return { baseDraft, leadingOps, scope: { sections, bilingual: true, siteLanguage }, hideOps };
}

/**
 * 首屏标题的确定性兜底。
 *
 * `hero.title` 是所有模板都标 `required` 的槽位——缺了它，站点会**继续显示模板自带的
 * 演示标题**（实测：jinggong 模板上残留 "为下一代标准而造。"），而且覆盖统计会判它缺失、
 * 直接把发布拦下。
 *
 * 但首屏标题是**批次调用的副产品**：批 A 的提示词要求它写 `hero.title/subtitle/cta`，
 * 而模型偶尔只输出 `hero.subtitle`。实测同一输入两次调用，一次写了、一次没写——
 * 也就是说「站点能不能发布」取决于一次模型的临时发挥，这是不可接受的。
 *
 * 兜底内容用**企业名**（`companyName` 必然存在，来自用户键入或确认页）。为什么不直接用
 * `summary`（更丰富的描述）：首屏标题是**版式受限**的槽位（截图里就是一行大标题），
 * 而 summary 是 400 字上限的段落，塞进 h1 会溢出。企业名短、必然真实、
 * 且"公司名 + 一句副标题"本身就是最常见的首屏形态。
 *
 * 只在模型**完全没写**时才补（已存在则原样返回），因此不会覆盖更好的模型产出。
 */
function ensureHeroTitle(ops: SiteOperation[], intent: SiteIntent, siteLanguage: "zh" | "en"): SiteOperation[] {
  const hasHeroTitle = ops.some((op) => op.op === "set_text" && op.target === "hero.title");
  if (hasHeroTitle) return [];
  // 截断上限取**契约**的 `hero.title` 容量，不再用魔法数 40——
  // 那个 40 来自已删除的手写可读长度表，是本次"两套数字打架"的残留之一。
  const value = intent.companyName.trim().slice(0, SLOT_MAX_LENGTH["hero.title"]);
  if (!value) return [];
  return [{ op: "set_text" as const, target: "hero.title", locale: siteLanguage, value }];
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
  const parts = [
    `【建站需求】业务类型：${businessLabel[intent.businessType] ?? intent.businessType}`,
    `公司/品牌：${intent.companyName}`,
    `行业：${intent.industry}`,
    `目标受众：${audienceLabel[intent.targetAudience] ?? intent.targetAudience}`,
    `语气风格：${toneLabel[intent.tone] ?? intent.tone}`,
  ];
  parts.push(`核心板块：${intent.coreSections.join("、")}`);
  parts.push(`站点概述：${intent.summary}`);
  return parts.join("\n");
}

/** 单批注入的素材字数上限。batchB 按板块拆 4 组并行，每组都带素材 → 成本 = 组数 × 字数。 */
export const SOURCE_MATERIAL_BUDGET = 8_000;

/**
 * 把用户粘贴的企业素材拼成注入块（2026-09-10，方向 2）。
 *
 * **此前的断点**：素材只在 analyze 阶段用于判断意图/选模板，
 * execute（真正写内容）的请求体里根本没有它，生成层 prompt 只拼了 intent 的 5 个字段摘要
 * → **用户粘的东西从不参与内容生成**，这是「内容精度不够」最直接的原因。
 *
 * 注入约束（与质检器的 fabricated 拦截方向一致）：
 *  - 素材**优先于**模型常识；冲突时以素材为准
 *  - 素材里**没有**的数字/认证/客户名**不得**写成事实（宁可留缺口标记）
 *  - 超预算截断并**明确标注已截断**，避免模型以为看到了全文
 */
export function buildSourceMaterialBlock(material: string | undefined, budget = SOURCE_MATERIAL_BUDGET): string {
  const trimmed = material?.trim();
  if (!trimmed) return "";
  const truncated = trimmed.length > budget;
  const body = truncated ? trimmed.slice(0, budget) : trimmed;
  return [
    "",
    "【用户提供的企业素材（以此为准，优先于你的常识）】",
    body,
    truncated ? `…（素材过长，此处已截断，仅呈现前 ${budget} 字）` : "",
    "使用要求：只使用上述素材中明确出现的事实（公司名、产品、数字、认证、案例）。",
    "素材中没有的信息不要编造——宁可按模板容量写少、写得实，也不要虚构数据或资质。",
  ].filter(Boolean).join("\n");
}

/** 从模板 presentation 提炼"每板块能装几条、什么形态"的容量提示，替换写死的"前3张卡片"。 */
export function buildPresentationCapacityText(capabilitySummary: TemplateCapabilitySummary, sections: string[]): string {
  const relevant = capabilitySummary.presentation.filter((p) => sections.includes(p.presentationSlot));
  if (!relevant.length) return "";
  return relevant
    .map((p) => `${p.presentationSlot}:${p.capacityDefault ? `约${p.capacityDefault}条` : ""}${p.capacityMax ? `(至多${p.capacityMax}条)` : ""}${p.hideUnlessFilled ? "，无可靠事实则该块隐藏" : ""}`)
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
function batchAHint(intent: SiteIntent, siteLanguage: "zh" | "en", siteModel: "corporate" | "portfolio" | "blog" = "corporate", sourceMaterial?: string): string {
  const lang = siteLanguage === "en"
    ? "首屏与导航使用英文，中文可留'待补充'"
    : "首屏与导航使用中文（英文可留'待补充'）";
  const nav = siteModelSectionLabels(siteModel).navHint;
  return `复用已选模板结构。第一批只填充元数据与首屏——siteName、companyName、industry、goal、hero.title/subtitle/cta、navigation.*。${lang}。不要改其他板块。第一批=首屏与导航的文字内容（标题/副文/按钮），不是首屏背景或整块视觉；首屏图形/背景由模板原样提供，不存在换图操作。${nav ? nav + "。" : ""}\n\n${buildEnhancedIntentPrompt(intent)}${buildSourceMaterialBlock(sourceMaterial)}`;
}

/** 批 B 提示：板块内容——按站点语言；用模板原生容量提示替代"前3张卡片"硬编码 */
function batchBHint(intent: SiteIntent, siteLanguage: "zh" | "en", capacityText: string, siteModel: "corporate" | "portfolio" | "blog" = "corporate", sourceMaterial?: string): string {
  const lang = siteLanguage === "en"
    ? "板块内容一律用英文书写"
    : "板块内容一律用中文书写";
  const capacityRule = capacityText
    ? `\n板块内容容量须贴合模板原生排版：${capacityText}。宁可按容量写少、写得实，不要为凑数空泛加卡。\n逐节规则：每填充一个板块，先在 templateAwareness 声明该节 nativeRole 与 plannedItems（须与下方模板原生排版一致），再产出该节操作；某节装不下 → fallbackDeclared 并说明理由，禁止为该节自造整块通用卡片区绕过模板。`
    : "每板块 2-4 条，宁少勿空。";
  const slotText = siteModelSectionLabels(siteModel).slotText;
  return `复用已选模板结构。第二批按板块填充内容——${slotText}。${lang}。不要为未列板块生成操作。${capacityRule}\n\n${buildEnhancedIntentPrompt(intent)}${buildSourceMaterialBlock(sourceMaterial)}`;
}

export type GenerateDraftArgs = {
  intent: SiteIntent;
  templateId: string;
  hiddenSections: string[];
  /** 站点当前是否已有商品；无则隐藏产品板块（见 `buildGenerationPlan` 的同名参数）。默认 true。 */
  hasProducts?: boolean;
  /**
   * 用户粘贴的企业素材（2026-09-10，方向 2）。会注入批次提示，让 AI 依据真实素材写内容，
   * 而不是只靠 intent 摘要泛泛而谈。与站点绑定存储（`getSiteSourceMaterial`）。
   */
  sourceMaterial?: string;
  siteLanguage?: "zh" | "en";
  draftOps: DraftOpsProvider;
  onProgress?: (progress: GenerationProgress) => void;
  /** 上游取消信号，客户端断开或路由超时时会中止所有活跃任务。 */
  signal?: AbortSignal;
  /** 整次生成共用的绝对截止时间，fallback/recovery 不得重置。 */
  deadlineAt?: number;
  /** 单个主任务的硬截止；生产默认 25 秒，测试可注入短时间。 */
  taskTimeoutMs?: number;
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
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; completedSections: string[]; partial: boolean; missingSections: string[]; requestedTemplateId: string; appliedTemplateId: string; templateFallbackReason?: string; sectionUnderstanding?: SectionUnderstandingReport[];
      /**
       * 被确定性校验拒绝的操作（人话原因）。
       *
       * 2026-09-11 之前这里**没有这个字段**：`validated.rejected` 被算出来就丢，
       * 于是「超长标题被拒 → 该槽位保留旧文案 → 界面照常提示成功」对用户完全静默。
       * 与 chat 路径（`rejected` 冒泡到 `done` 事件）对齐，前端统一消费。
       */
      rejected: string[] }
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
  if (operation.op === "update_item" || operation.op === "add_item" || operation.op === "remove_item") return operation.section === section;
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
    new Set(allTemplates().map((template) => template.id)),
    {
      presentation: getTemplatePresentation(appliedTemplateId).map((p) => ({ presentationSlot: p.presentationSlot, capacityMax: p.capacity.max })),
      baseCounts: {
        features: plan.baseDraft.content.features.items.length,
        services: plan.baseDraft.content.services.items.length,
      },
    },
  );
  return {
    ok: true,
    summary: "模型响应较慢，已先保存公司信息与首屏初稿，其余板块待补全。",
    operations: validated.operations,
    model: "local-fast-fallback",
    completedSections: ["hero"],
    partial: true,
    missingSections,
    requestedTemplateId,
    appliedTemplateId,
    templateFallbackReason: reason,
    rejected: validated.rejected,
  };
}

/** 为现有模板生成内容：批 A/B 并行 → 合并确定性校验 → 单次提交。 */
export async function generateDraftOperations(args: GenerateDraftArgs): Promise<GenerateDraftOutcome> {
  if (args.signal?.aborted) return { ok: false, code: "aborted", error: "内容生成已取消" };
  if (remainingBudgetMs(args.deadlineAt) <= 0) return { ok: false, code: "timeout", error: "内容生成超时" };
  const requestedTemplateId = args.templateId;
  const appliedTemplateId = allTemplates().some((template) => template.id === requestedTemplateId) ? requestedTemplateId : "forge";
  const templateFallbackReason = appliedTemplateId === requestedTemplateId ? undefined : `模板 ${requestedTemplateId} 不可用，已回退到 forge`;
  const plan = buildGenerationPlan(args.intent, appliedTemplateId, args.hiddenSections, args.siteLanguage, args.hasProducts ?? true);
  const lang = plan.scope.siteLanguage;
  // P0 过程痕迹：单次生成的 runId；traceCtx 透传给每批 AI 调用
  const runId = createTraceRunId();
  appendGenerationTrace({
    kind: "run.begin",
    runId,
    mode: "full",
    requestedTemplateId,
    appliedTemplateId,
    ...(templateFallbackReason ? { templateFallbackReason } : {}),
    sections: plan.scope.sections,
    siteLanguage: lang,
    ...(args.deadlineAt ? { deadlineAt: args.deadlineAt } : {}),
    ts: Date.now(),
  });
  const traceOutcome = (outcome: GenerateDraftOutcome) => {
    if (!outcome.ok) {
      appendGenerationTrace({ kind: "run.outcome", runId, outcome: "error", ts: Date.now() });
      return;
    }
    appendGenerationTrace({
      kind: "run.outcome",
      runId,
      outcome: outcome.partial ? "partial" : "complete",
      model: outcome.model,
      partial: outcome.partial,
      missingSections: outcome.missingSections,
      requestedTemplateId: outcome.requestedTemplateId,
      appliedTemplateId: outcome.appliedTemplateId,
      ...(outcome.templateFallbackReason ? { templateFallbackReason: outcome.templateFallbackReason } : {}),
      ts: Date.now(),
    });
  };
  // 两批只读取同一模板草稿且目标字段互不重叠，可并行缩短等待时间；合并后仍只提交一次。
  const completedSections = new Set<string>();
  const recoveringSections = new Set<string>();
  const failedSections = new Set<string>();
  const declarations: SectionAwarenessDeclaration[] = [];
  /** 记录批次开始/结果/逐槽对账（P0：事后可回答"AI 每节是否理解、哪节兜底"） */
  const traceBatchStart = (batch: TraceBatchId, sections: string[], manifestVersion: number) => {
    appendGenerationTrace({ kind: "batch.start", runId, batch, sections, templateId: appliedTemplateId, manifestVersion, ts: Date.now() });
  };
  const traceBatchResult = (batch: TraceBatchId, result: DraftOpsResult) => {
    appendGenerationTrace({
      kind: "batch.result",
      runId,
      batch,
      ok: result.ok,
      ...(result.ok ? { opCount: result.operations.length, model: result.model } : { code: result.code, error: result.error }),
      ts: Date.now(),
    });
  };
  const traceBatchAdopted = (batch: TraceBatchId, result: DraftOpsResult, capability: TemplateCapabilitySummary) => {
    if (!result.ok) return;
    if (result.awareness?.length) declarations.push(...result.awareness);
    const presentation = capability.presentation.map((p) => ({ presentationSlot: p.presentationSlot, role: p.role, capacityMax: p.capacityMax }));
    /**
     * `slotMap` 是**追踪日志的字段格式**（见 `generation-trace.ts` 的 `batch.adopted`），
     * 不是契约字段——这里保留 `slot` 键名不改，避免新旧 trace 格式不一致。
     * 语义上它存的就是 `presentationSlot`（模板段名）。
     */
    const slotMap = presentation
      .filter((p) => plan.scope.sections.includes(p.presentationSlot) || p.presentationSlot === "hero")
      .map((p) => {
        const section = p.presentationSlot;
        const ops = result.operations.filter((op) => {
          if (op.op === "set_text") return op.target.startsWith(`${section}.`);
          if ("section" in op) return op.section === section;
          return false;
        });
        const itemCount = result.operations.filter((op) => "section" in op && op.section === section).length;
        return {
          slot: section,
          opType: [...new Set(ops.map((op) => op.op))].join("|") || "none",
          targetCount: ops.length,
          displayTargets: ops.map((op) => ("target" in op ? String(op.target) : `${section}.items`)),
          presentationRole: p.role,
          capacityMax: p.capacityMax,
          withinCapacity: itemCount <= p.capacityMax,
        };
      });
    appendGenerationTrace({ kind: "batch.adopted", runId, batch, slotMap, ts: Date.now() });
  };
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
  const batchACapability = buildTemplateCapabilitySummary(appliedTemplateId, lang);
  traceBatchStart("batchA", plan.scope.sections, batchACapability.manifestVersion);
  const batchAPromise = runDraftTask(args.draftOps, {
      intent: args.intent,
      templateId: appliedTemplateId,
      baseDraft: plan.baseDraft,
      scope: { sections: plan.scope.sections, bilingual: true, siteLanguage: lang },
      attemptHint: batchAHint(args.intent, lang, plan.baseDraft.siteModel, args.sourceMaterial),
      deadlineAt: args.deadlineAt,
      capabilitySummary: batchACapability,
      traceCtx: { runId, batch: "batchA" },
    }, initialTaskTimeoutMs, args.signal).then((result) => {
      traceBatchResult("batchA", result);
      traceBatchAdopted("batchA", result, batchACapability);
      if (result.ok) completedSections.add("hero"); else failedSections.add("hero");
      reportProgress("content", result.ok ? "首屏内容已完成，正在填充其余板块…" : "首屏内容生成失败");
      return result;
    });
  const batchBSummary = buildTemplateCapabilitySummary(appliedTemplateId, lang);
  const batchBCapacityText = buildPresentationCapacityText(batchBSummary, plan.scope.sections);
  // 分而治之（2026-09-08 可靠性改造）：把板块拆成小组并行，每组独立自适应超时、返回即计入。
  // 动机：实测单批全量输出 5000+ token / 70s，撞 60s 硬截止必然全丢；拆小后单请求快且不截断。
  const sectionGroups = planSectionGroups(plan.scope.sections);
  const groupResults: Array<{ group: SectionGroup; result: DraftOpsResult }> = [];
  const runGroup = async (group: SectionGroup): Promise<void> => {
    // 上游取消后不再发起新请求（保持"abort 即停"语义）
    if (args.signal?.aborted) {
      group.sections.forEach((section) => failedSections.add(section));
      groupResults.push({ group, result: { ok: false, code: "aborted", error: "内容生成已取消" } });
      return;
    }
    const groupKey = `${appliedTemplateId}:group:${group.sections.join("+")}`;
    // 预算不足时不做请求（与既有"insufficient budget skips recovery"语义一致）
    const remaining = remainingBudgetMs(args.deadlineAt);
    if (remaining < MIN_RECOVERY_TASK_BUDGET_MS) {
      group.sections.forEach((section) => failedSections.add(section));
      groupResults.push({ group, result: { ok: false, code: "timeout", error: "剩余时间不足" } });
      return;
    }
    // 显式注入的 taskTimeoutMs 优先（测试/特殊场景），否则用自适应超时
    const adaptive = args.taskTimeoutMs ?? adaptiveTimeoutMs(groupKey);
    const timeoutMs = Math.min(adaptive, Math.max(1, remaining));
    const startedAt = Date.now();
    traceBatchStart("batchB", group.sections, batchBSummary.manifestVersion);
    const result = await runDraftTask(args.draftOps, {
      intent: args.intent,
      templateId: appliedTemplateId,
      baseDraft: plan.baseDraft,
      scope: { sections: group.sections, bilingual: false, siteLanguage: lang },
      attemptHint: batchBHint(args.intent, lang, buildPresentationCapacityText(batchBSummary, group.sections), plan.baseDraft.siteModel, args.sourceMaterial),
      deadlineAt: args.deadlineAt,
      capabilitySummary: batchBSummary,
      traceCtx: { runId, batch: "batchB" },
    }, timeoutMs, args.signal);
    recordLatency({ taskKey: groupKey, latencyMs: Date.now() - startedAt, ok: result.ok });
    traceBatchResult("batchB", result);
    traceBatchAdopted("batchB", result, batchBSummary);
    if (result.ok) {
      group.sections.forEach((section) => completedSections.add(section));
      reportProgress("content", `${group.sections.join("、")} 板块已完成`);
    } else {
      group.sections.forEach((section) => failedSections.add(section));
      reportProgress("content", `${group.sections.join("、")} 板块暂未完成`);
    }
    groupResults.push({ group, result });
  };
  // 并发池：限制同时在途的 AI 请求数。
  //
  // **2026-09-10 修复「每次生成必然砍掉尾部板块」**：
  // 此前 `MAX_GROUP_CONCURRENCY = Math.max(1, MAX_INFLIGHT - 1)` 被写死为 **1**，
  // 即分组**串行**执行；但预算公式按并发 **2** 估算（`generate/route.ts` 的
  // `computeGenerationBudgetMs({ groupCount, concurrency: 2 })`）→ 预算被低估约一半
  // （4 组算出 192s，串行实需 ~360s）→ **尾部 1-2 个板块必然被 deadline 砍掉**。
  // 这与上面的设计注释「把板块拆成小组**并行**」也自相矛盾。
  //
  // 共享并发池（2026-09-10 修复「每次生成必然砍掉尾部板块」）：
  //
  // 问题：此前分组并发被写死为 1（串行），而预算公式按并发 2 估算
  //   → 4 组算出 192s，串行实需 ~360s → **尾部 1-2 个板块必然被 deadline 砍掉**。
  // 但不能简单放开到 2：原注释的「并发过多会互相拖慢、加剧超时」有实测依据，
  // 且 batchA 与分组同时跑会到 3 个在途请求。
  //
  // 方案：**共享一个容量为 `groupConcurrency` 的池**——batchA 占一个槽，
  // 余下的槽立刻跑分组；任何一个返回即释放，下一个补上。
  // 于是全局在途恒 ≤ groupConcurrency，且 batchA 卡住时分组**不会干等**。
  const groupQueue = [...sectionGroups];
  let availableSlots = GENERATION_BUDGET.groupConcurrency;
  const slotWaiters: Array<() => void> = [];
  const acquireSlot = async (): Promise<void> => {
    if (availableSlots > 0) {
      availableSlots -= 1;
      return;
    }
    await new Promise<void>((resolve) => slotWaiters.push(resolve));
  };
  const releaseSlot = (): void => {
    const next = slotWaiters.shift();
    if (next) next();
    else availableSlots += 1;
  };
  const runGroupWorker = async (): Promise<void> => {
    while (groupQueue.length) {
      const group = groupQueue.shift();
      if (!group) break;
      await acquireSlot();
      try {
        await runGroup(group);
      } finally {
        releaseSlot();
      }
    }
  };
  // batchA 先占一槽，分组 worker 与之共享剩余容量
  const batchAWithSlot = batchAPromise.then(async (result) => {
    releaseSlot();
    return result;
  });
  const batchBPromise = (async () => {
    await acquireSlot();
    void batchAWithSlot.finally(releaseSlot);
    await Promise.all(
      Array.from({ length: Math.min(GENERATION_BUDGET.groupConcurrency, sectionGroups.length) }, () => runGroupWorker()),
    );
    return ((): DraftOpsResult => {
      const okResults = groupResults.map((g) => g.result).filter((r): r is Extract<DraftOpsResult, { ok: true }> => r.ok);
      if (!okResults.length) {
        const first = groupResults[0]?.result;
        return first && !first.ok ? first : { ok: false, code: "timeout", error: "所有板块组均未完成" };
      }
      return {
        ok: true,
        summary: okResults.map((r) => r.summary).join("；"),
        operations: okResults.flatMap((r) => r.operations),
        model: okResults.at(-1)?.model ?? "",
        awareness: okResults.flatMap((r) => r.awareness ?? []),
      };
    })();
  })();
  const [batchA, initialBatchB] = await Promise.all([batchAWithSlot, batchBPromise]);
  if (!batchA.ok) {
    appendGenerationTrace({ kind: "fallback", runId, fallbackKind: "template_switch", reason: batchA.error ?? "", requestedTemplateId, appliedTemplateId, ts: Date.now() });
    if (appliedTemplateId !== "forge" && !args.signal?.aborted && hasFallbackBudget(remainingBudgetMs(args.deadlineAt))) {
      reportProgress("content", `模板 ${appliedTemplateId} 生成异常，正在切换兼容模板…`);
      const fallback = await generateDraftOperations({ ...args, templateId: "forge" });
      if (fallback.ok) {
        traceOutcome(fallback);
        return {
          ...fallback,
          operations: ensureTemplateOperation(fallback.operations, "forge"),
          requestedTemplateId,
          templateFallbackReason: `模板 ${appliedTemplateId} 生成异常，已切换到兼容模板 forge`,
        };
      }
      if (fallback.code === "aborted" || args.signal?.aborted) {
        traceOutcome(fallback);
        return fallback;
      }
      const fastFallback = buildFastFallbackOutcome(
        args,
        buildGenerationPlan(args.intent, "forge", args.hiddenSections, args.siteLanguage, args.hasProducts ?? true),
        requestedTemplateId,
        "forge",
        `模板 ${appliedTemplateId} 与兼容模板均未在时限内响应，已保存快速初稿。`,
        initialBatchB.ok ? initialBatchB.operations : [],
      );
      appendGenerationTrace({ kind: "fallback", runId, fallbackKind: "local_fast", reason: "兼容模板也未响应", requestedTemplateId, appliedTemplateId: "forge", ts: Date.now() });
      traceOutcome(fastFallback);
      return fastFallback;
    }
    if (args.signal?.aborted) {
      const aborted = { ok: false as const, code: "aborted", error: "内容生成已取消" };
      traceOutcome(aborted);
      return aborted;
    }
    if (appliedTemplateId === "forge") {
      const fastFallback = buildFastFallbackOutcome(
        args,
        plan,
        requestedTemplateId,
        appliedTemplateId,
        "模型响应较慢，已保存快速初稿，其余板块待补全。",
        initialBatchB.ok ? initialBatchB.operations : [],
      );
      appendGenerationTrace({ kind: "fallback", runId, fallbackKind: "local_fast", reason: "模型响应慢", requestedTemplateId, appliedTemplateId, ts: Date.now() });
      traceOutcome(fastFallback);
      return fastFallback;
    }
    const failed = { ok: false as const, code: batchA.code, error: batchA.error };
    traceOutcome(failed);
    return failed;
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
            attemptHint: `${batchBHint(args.intent, lang, buildPresentationCapacityText(buildTemplateCapabilitySummary(appliedTemplateId, lang), [section]), plan.baseDraft.siteModel, args.sourceMaterial)}\n\n恢复模式：只生成 ${section} 板块，其他板块不要产生操作。`,
            maxAttempts: 1,
            deadlineAt: recoveryDeadlineAt,
            capabilitySummary: buildTemplateCapabilitySummary(appliedTemplateId, lang),
            traceCtx: { runId, batch: "recovery" },
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
  // 首屏标题兜底（见函数说明）
  ops = [...ensureHeroTitle(ops, args.intent, plan.scope.siteLanguage), ...ops];

  // 校验（白名单 + 长度 + 模板原生容量，生成场景专用：set_template 只查白名单，不要求"明确换模板"）
  const templateIds = new Set(allTemplates().map((t) => t.id));
  const validated = validateGenerationOperations(ops, templateIds, {
    presentation: batchBSummary.presentation.map((p) => ({ presentationSlot: p.presentationSlot, capacityMax: p.capacityMax })),
    baseCounts: {
      features: plan.baseDraft.content.features.items.length,
      services: plan.baseDraft.content.services.items.length,
    },
  });
  reportProgress("review", "内容已生成，正在核对板块、语言与可编辑字段…");
  // 逐节对账：模型声明 vs 实际采用的操作/容量（红队修正：硬指标=贴合容量与兜底一致性）
  const sectionUnderstanding = reconcileSectionUnderstanding({
    sections: plan.scope.sections,
    ops: validated.operations,
    presentation: batchBSummary.presentation.map((p) => ({ presentationSlot: p.presentationSlot, role: p.role, capacityMax: p.capacityMax })),
    declarations,
    hiddenSections: args.hiddenSections,
  });
  appendGenerationTrace({ kind: "run.outcome", runId, outcome: failedSections.size > 0 ? "partial" : "complete", model, partial: failedSections.size > 0, missingSections: plan.scope.sections.filter((s) => failedSections.has(s)), requestedTemplateId, appliedTemplateId, ...(templateFallbackReason ? { templateFallbackReason } : {}), ts: Date.now() });
  const outcome: GenerateDraftOutcome = {
    ok: true,
    summary,
    operations: validated.operations,
    model,
    completedSections: ["hero", ...plan.scope.sections].filter((section) => completedSections.has(section)),
    // P0-2 假成功修复：批 B（板块内容）失败时明确标记 partial，前端提示"板块未完整生成，可让 AI 补全"，
    // 避免用户看到默认模板的 Forge 演示文案却以为生成成功。
    partial: failedSections.size > 0,
    missingSections: plan.scope.sections.filter((section) => failedSections.has(section)),
    requestedTemplateId,
    appliedTemplateId,
    sectionUnderstanding,
    rejected: validated.rejected,
    ...(templateFallbackReason ? { templateFallbackReason } : {}),
  };
  return outcome;
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
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; completedSections: string[]; partial: false; missingSections: []; rejected: string[] }
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
  if (operation.op === "update_item" || operation.op === "add_item" || operation.op === "remove_item") {
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
  // 校验（白名单 + 长度 + 容量，与生成场景一致；mode=all 才允许增删卡）
  const templateIds = new Set(allTemplates().map((t) => t.id));
  const validated = validateGenerationOperations(result.operations, templateIds, {
    presentation: getTemplatePresentation(args.baseDraft.templateId).map((p) => ({ presentationSlot: p.presentationSlot, capacityMax: p.capacity.max })),
    baseCounts: {
      features: args.baseDraft.content.features.items.length,
      services: args.baseDraft.content.services.items.length,
    },
  }, args.mode === "all" ? "regenerate-structure" : "regenerate");
  return {
    ok: true,
    summary: result.summary,
    operations: validated.operations.filter((operation) => operationBelongsToSection(operation, args.section)),
    model: result.model,
    completedSections: [args.section],
    partial: false,
    missingSections: [],
    rejected: validated.rejected,
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
  | { ok: true; summary: string; operations: SiteOperation[]; model: string; completedSections: SectionKey[]; partial: boolean; missingSections: SectionKey[]; rejected: string[] }
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
    completedSections: completed.map((item) => item.section),
    partial: missingSections.length > 0,
    missingSections,
    rejected: [...new Set(successfulOutcomes.flatMap((outcome) => outcome.rejected))],
  };
}
