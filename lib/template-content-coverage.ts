import { defaultDraft, type Locale, type SiteDraft } from "./site-document.ts";
import type { TemplateContentTarget, TemplateManifest } from "./template-manifest.ts";

export type ContentCoverageReport = {
  filledTargets: string[];
  aiFilledTargets: string[];
  /** 该写没写：空值、模板 demo 残留（AI 的责任） */
  pendingTargets: string[];
  /**
   * 事实缺失：AI 按"宁缺勿假"如实标注的缺口（"待补充"）。
   * 只有真实企业事实（电话/邮箱/地址）允许——AI 无从编造这些。
   * 可发布（发布时隐藏该字段），但提示用户补齐。
   */
  placeholderTargets: string[];
  /**
   * 伪造内容：example.com、lorem ipsum 这类假数据。
   * 比缺失更糟——访客会当成真信息，必须阻断发布。
   */
  fabricatedTargets: string[];
  residualDemoSlots: string[];
  unmappedRequiredTargets: string[];
};

type VisibleTextsBySlot = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * 槽位取值解析器注册表。
 *
 * 此前是一个硬编码 switch——P4 新增行业节（资质墙/厂房/新闻/地图）时必须改这个函数，
 * 否则新槽位落进 `unmappedRequiredTargets`（无法质检）。改为注册表后，
 * 新节在自己的模块里 `registerTargetResolver("certificates.items", ...)` 一次即可。
 */
export type TargetResolver = (draft: SiteDraft, locale: Locale) => string[] | undefined;

const targetResolvers = new Map<string, TargetResolver>([
  ["hero.title", (draft, locale) => [draft.content.hero.title[locale]]],
  // hero.subtitle 不在 TemplateContentTarget 里（无独立槽位），但质检/语言检查需要它。
  ["hero.subtitle", (draft, locale) => [draft.content.hero.subtitle[locale]]],
  ["about.body", (draft, locale) => [draft.content.about.body[locale]]],
  ["features.items", (draft, locale) => draft.content.features.items.flatMap((item) => [item.title[locale], item.body[locale]])],
  ["services.items", (draft, locale) => draft.content.services.items.flatMap((item) => [item.title[locale], item.body[locale]])],
  ["products", (draft, locale) => draft.products.flatMap((product) => [product.name[locale], product.summary[locale], product.category])],
  ["contact.title", (draft, locale) => [draft.content.contact.title[locale]]],
  ["contact.body", (draft, locale) => [draft.content.contact.body[locale]]],
  ["contact.email", (draft) => [draft.content.contact.email]],
  ["contact.phone", (draft) => [draft.content.contact.phone]],
  ["contact.address", (draft, locale) => [draft.content.contact.address[locale]]],
]);

/** 注册新槽位的取值解析器（新增行业节时调用一次）。 */
export function registerTargetResolver(target: string, resolve: TargetResolver): void {
  targetResolvers.set(target, resolve);
}

export function getTargetResolvers(): ReadonlyMap<string, TargetResolver> {
  return targetResolvers;
}

function targetValues(draft: SiteDraft, target: string, locale: Locale): string[] | undefined {
  return targetResolvers.get(target)?.(draft, locale);
}

export function resolveDraftTarget(
  draft: SiteDraft,
  target: TemplateContentTarget | string,
): readonly string[] | undefined {
  return targetValues(draft, target, draft.locale);
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizedValues(values: readonly string[]) {
  return values.map(normalize);
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = normalizedValues(left);
  const normalizedRight = normalizedValues(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

// 伪造/垃圾占位：示例文案与保留域名（RFC 2606/6761：example.com/net/org、*.example/.test/.invalid）
const garbagePattern = /(?:\blorem\s+ipsum\b|\bexample\.(?:com|net|org|edu)\b|\b[a-z0-9-]+\.(?:example|test|invalid)\b)/i;
// 诚实缺口标记：AI 按"宁缺勿假"如实标注的缺口
const placeholderPattern = /(?:待补充|暂无|敬请期待|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon)/i;
const placeholderPatternGlobal = /(?:待补充|暂无|敬请期待|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon)/gi;
// 剥掉标记后允许残留的"标签"长度：如"地址待补充""设备明细待补充"仍是标记本身；
// 而"企业事实尚未提供的部分将明确标记为待补充"这类描述性句子残留很长，属正文。
const PLACEHOLDER_LABEL_MAX_CHARS = 10;

/**
 * 允许"待补充"的槽位语义（注册表，可扩展）。
 *
 * 只有**真实企业事实**才该用占位标记——AI 无从编造这些数据。
 * 其余槽位（首屏标题、公司故事、服务卡片…）是创意文案，AI 本该写得出来，
 * 出现"待补充"就是没干活，按缺口处理。
 */
const placeholderTolerantSemanticTypes = new Set<string>([
  "contact_phone",
  "contact_email",
  "contact_address",
]);

export function getPlaceholderTolerantSemanticTypes(): readonly string[] {
  return [...placeholderTolerantSemanticTypes];
}

function hasPendingValue(values: readonly string[]) {
  return values.length === 0 || values.some((value) => !normalize(value));
}

/** 伪造/垃圾占位（lorem ipsum、example.com 等）——不是诚实标注，按未完成处理 */
export function isGarbageValue(value: string) {
  return garbagePattern.test(value);
}

/**
 * 诚实缺口标记（"待补充"等）。
 * 与 isGarbageValue 分开：它表示 AI 如实标注的缺口，不是缺陷。
 * 判定为"标记本身"而非"正文"的依据：剥掉标记与标点后几乎没有实义残留。
 */
export function isPlaceholderValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !placeholderPattern.test(trimmed)) return false;
  const residue = trimmed.replace(placeholderPatternGlobal, "").replace(/[\s\p{P}\p{S}]/gu, "");
  return Array.from(residue).length <= PLACEHOLDER_LABEL_MAX_CHARS;
}

function containsFingerprint(values: readonly string[], fingerprints: readonly string[]) {
  const normalizedText = normalizedValues(values).join("\n");
  return fingerprints.some((fingerprint) => {
    const normalizedFingerprint = normalize(fingerprint);
    return normalizedFingerprint.length > 0 && normalizedText.includes(normalizedFingerprint);
  });
}

function targetWasApplied(target: string, appliedTargets: readonly string[]) {
  return appliedTargets.some((appliedTarget) => (
    appliedTarget === target
    || appliedTarget.startsWith(`${target}.`)
    || target.startsWith(`${appliedTarget}.`)
  ));
}

export function detectTemplateDemoResidue(args: {
  manifest: TemplateManifest;
  visibleTexts: VisibleTextsBySlot;
}): string[] {
  const residualDemoSlots: string[] = [];
  const seen = new Set<string>();

  for (const slot of args.manifest.slots) {
    if (seen.has(slot.target)) continue;
    seen.add(slot.target);
    const visibleText = args.visibleTexts[slot.target];
    const values = typeof visibleText === "string" ? [visibleText] : visibleText ?? [];
    if (containsFingerprint(values, slot.demoFingerprints)) residualDemoSlots.push(slot.target);
  }

  return residualDemoSlots;
}

export function classifyDraftCoverage(args: {
  draft: SiteDraft;
  manifest: TemplateManifest;
  appliedTargets: readonly string[];
}): ContentCoverageReport {
  const report: ContentCoverageReport = {
    filledTargets: [],
    aiFilledTargets: [],
    pendingTargets: [],
    placeholderTargets: [],
    fabricatedTargets: [],
    residualDemoSlots: [],
    unmappedRequiredTargets: [],
  };
  const seen = new Set<string>();
  /**
   * **用户主动隐藏的板块不算缺口**（2026-09-12）。
   *
   * 这条口径此前只存在于 `evaluateDraftQuality` 里（它拿了本函数的报告之后再过滤一遍），
   * 而本函数自己**不认** `hiddenSections`——同一个概念两处口径，于是：
   *
   *  - `evaluateDraftQuality` 认为"隐藏了就不算缺"（对）；
   *  - `route.ts` 的 `coverageForRecord` 直接拿本函数的 `pendingTargets` 去算
   *    `missingSections`，**把已隐藏的板块也算成缺口**（错）。
   *
   * 后果（真机实测 2026-09-12）：站点因为"还没有商品"而自动隐藏了 `products`
   * （见 `site-generator.buildGenerationPlan` 的 `hasProducts`），生成器**也没有**再为它发请求，
   * 但覆盖率仍把 `products` 报成待填 → `partial=true` → 工作台一直挂着
   * 「部分板块未完整生成」，而用户点「去补全」也永远补不完（生成侧根本不生成它）。
   *
   * 加在源头，三处消费者自动一致——不再要求每个调用方记得自己过滤一遍。
   */
  const hidden = new Set<string>(args.draft.hiddenSections ?? []);

  for (const slot of args.manifest.slots) {
    if (seen.has(slot.target)) continue;
    seen.add(slot.target);
    // 隐藏板块的槽位直接跳过：用户明确不要它，就不该被任何口径当成"没写完"
    if (hidden.has(slot.target.split(".")[0] ?? "")) continue;
    const values = targetValues(args.draft, slot.target, args.draft.locale);
    if (!values) {
      if (slot.required) report.unmappedRequiredTargets.push(slot.target);
      continue;
    }

    const defaultValues = targetValues(defaultDraft, slot.target, args.draft.locale) ?? [];

    // 伪造内容（example.com / lorem ipsum）→ 比缺失更糟，必须阻断发布
    if (values.some(isGarbageValue)) {
      report.fabricatedTargets.push(slot.target);
      continue;
    }

    // 空值 → 该写没写
    if (hasPendingValue(values)) {
      report.pendingTargets.push(slot.target);
      continue;
    }

    /**
     * 事实缺失（"待补充"）→ 只限"企业事实类"槽位，可发布（发布时隐藏该字段）。
     *
     * **必须早于 demo 残留与 sameValues 判定**（注释一直这么写，但 2026-09-12 前
     * 代码把 demo 残留的 push 放在了这段**之前**，两边不一致）。踩到的后果：
     * `contact.phone` / `contact.address` 同时被塞进 `residualDemoSlots` **和**
     * `placeholderTargets`——一边说它是"模板演示残留"（硬缺口），
     * 另一边说它是"AI 如实标注的缺口"（可发布）。`coverageForRecord` 取前者算
     * `missingSections`，于是**如实留"待补充"的站永远发布不了，且永远补不完**
     * （AI 本就不该编造电话和地址）。真机实测：新建站的 `partial` 卡在 `contact`。
     *
     * 默认草稿的 phone/address 本身就是占位标记，部分模板也把它登记进了
     * `demoFingerprints`——两种口径都会把它误判，所以这段必须排在它们前面。
     */
    const hasPlaceholder = values.some(isPlaceholderValue);
    if (hasPlaceholder && placeholderTolerantSemanticTypes.has(slot.semanticType)) {
      report.placeholderTargets.push(slot.target);
      continue;
    }

    const hasDemoResidue = containsFingerprint(values, slot.demoFingerprints);
    if (hasDemoResidue) report.residualDemoSlots.push(slot.target);

    // 模板 demo 残留 / 占位出现在"本该 AI 写"的槽（如首屏标题写"待补充"）/ 与默认相同
    // → 都是没干活，按缺口处理
    if (hasDemoResidue || hasPlaceholder || sameValues(values, defaultValues)) {
      report.pendingTargets.push(slot.target);
      continue;
    }

    if (targetWasApplied(slot.target, args.appliedTargets)) report.aiFilledTargets.push(slot.target);
    else report.filledTargets.push(slot.target);
  }

  return report;
}
