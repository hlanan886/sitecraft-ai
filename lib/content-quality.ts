import { checkDraftFacts } from "./fact-check.ts";
import { policyDecision, qualityScore, type PolicyCounts } from "./content-policy.ts";
import { classifyDraftCoverage, getPlaceholderTolerantSemanticTypes, isGarbageValue, isPlaceholderValue, resolveDraftTarget } from "./template-content-coverage.ts";
import type { Locale, SiteDraft } from "./site-document.ts";
import type { TemplateContentTarget, TemplateManifest, TemplateSlotBinding } from "./template-manifest.ts";

export type ContentQualityReport = {
  /** 该写没写：空值、模板 demo 残留（AI 的责任）——阻断发布 */
  missingSlots: string[];
  /** 伪造内容（example.com / lorem ipsum）——比缺失更糟，阻断发布 */
  fabricatedTargets: string[];
  /**
   * 元说明：AI 把"待补充"写成面向访客的说明句
   * （如"企业事实尚未提供的部分将明确标记为待补充"）——阻断发布，让 AI 重写。
   * 这是给站主看的标记，不是文案（2026-09-08）。
   */
  metaCommentaryTargets: string[];
  /**
   * 事实缺失（"待补充"）：只有真实企业事实（电话/邮箱/地址）允许。
   * 不阻断发布（发布时隐藏该字段），只提示用户补齐。
   */
  placeholderTargets: string[];
  overLimitSlots: string[];
  languageMismatches: string[];
  unverifiedFacts: string[];
  /**
   * 各策略规则的命中数（策略树口径）。
   * 发布门据此调用 `policyDecision(counts, factsConfirmed)`——不再自己列字段。
   */
  counts: PolicyCounts;
  score: number;
  publishable: boolean;
};

/**
 * 质量分档位（产品定义，2026-09-08）。
 * 分数只在"没有阻断项"时才有意义——有阻断项时一律 blocked。
 */
export const QUALITY_TIERS = Object.freeze({
  /** ≥90：可直接发布 */
  direct: 90,
  /** 70–89：可发布，建议再改 */
  review: 70,
});

export type QualityTier = "blocked" | "polish" | "review" | "direct";

export const QUALITY_TIER_LABELS: Readonly<Record<QualityTier, string>> = Object.freeze({
  blocked: "需先处理阻断项",
  polish: "建议先完善再发布",
  review: "可发布，建议再改几处",
  direct: "可直接发布",
});

export function qualityTier(report: ContentQualityReport): QualityTier {
  if (!report.publishable) return "blocked";
  if (report.score >= QUALITY_TIERS.direct) return "direct";
  if (report.score >= QUALITY_TIERS.review) return "review";
  return "polish";
}

type QualityOptions = {
  factReference?: string;
  /**
   * 已实际落地的目标（来自 changeSet.appliedTargets）。
   * 缺失时会把"用户手动填的槽"记为 filled 而非 aiFilled——只是归因差异，
   * 不影响 missing/score（缺失/占位判定与它无关）。
   */
  appliedTargets?: readonly string[];
};

const PLACEHOLDER_PATTERN = /(?:\blorem\s+ipsum\b|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon|待补充|暂无|敬请期待|example\.com)/i;
type QualityTarget = TemplateContentTarget | "hero.subtitle";

/** 占位/垃圾值没有语言可言，跳过语言一致性判定，避免二次扣分 */
function isNonCopyValue(value: string) {
  return isPlaceholderValue(value) || isGarbageValue(value) || PLACEHOLDER_PATTERN.test(value);
}

/**
 * 元说明：AI 把缺口标记写成了面向访客的说明句。
 * 例："企业事实尚未提供的部分将明确标记为待补充。"
 * 这是给站主看的，不是文案——出现在正文里专业度崩坏，必须让 AI 重写。
 */
const META_COMMENTARY_PATTERN = /(?:(?:将|会|已|明确)?(?:标记|标注|注明)为?["“]?待补充|待补充(?:后|之后)(?:更新|补充|完善)|尚未提供|未提供的部分|待补全)/;

const NON_LOCALIZED_TARGETS = new Set<QualityTarget>([
  "contact.email",
  "contact.phone",
]);

function targetValues(draft: SiteDraft, target: QualityTarget, locale: Locale): string[] {
  // 槽位取值统一由 template-content-coverage 的解析器提供（单一真相源）：
  // 此前两处各写一遍 switch，新增槽位必然漏改一处。
  return [...(resolveDraftTarget(draft, target) ?? [])];
}

function textForFacts(draft: SiteDraft): Array<{ source: string; text: string }> {
  const texts: Array<{ source: string; text: string }> = [];
  const add = (source: string, text: string) => texts.push({ source, text });
  for (const locale of ["zh", "en"] as const) {
    add(`hero.title.${locale}`, draft.content.hero.title[locale]);
    add(`hero.subtitle.${locale}`, draft.content.hero.subtitle[locale]);
    add(`about.title.${locale}`, draft.content.about.title[locale]);
    add(`about.body.${locale}`, draft.content.about.body[locale]);
    add(`features.title.${locale}`, draft.content.features.title[locale]);
    add(`features.intro.${locale}`, draft.content.features.intro[locale]);
    draft.content.features.items.forEach((item, index) => {
      add(`features.items.${index}.title.${locale}`, item.title[locale]);
      add(`features.items.${index}.body.${locale}`, item.body[locale]);
    });
    add(`services.title.${locale}`, draft.content.services.title[locale]);
    add(`services.intro.${locale}`, draft.content.services.intro[locale]);
    draft.content.services.items.forEach((item, index) => {
      add(`services.items.${index}.title.${locale}`, item.title[locale]);
      add(`services.items.${index}.body.${locale}`, item.body[locale]);
    });
    add(`products.title.${locale}`, draft.content.products.title[locale]);
    add(`products.intro.${locale}`, draft.content.products.intro[locale]);
    draft.products.forEach((product) => {
      add(`products.${product.sku}.name.${locale}`, product.name[locale]);
      add(`products.${product.sku}.summary.${locale}`, product.summary[locale]);
    });
    add(`contact.title.${locale}`, draft.content.contact.title[locale]);
    add(`contact.body.${locale}`, draft.content.contact.body[locale]);
    add(`contact.address.${locale}`, draft.content.contact.address[locale]);
  }
  add("contact.email", draft.content.contact.email);
  add("contact.phone", draft.content.contact.phone);
  return texts;
}

function hasCjk(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function hasLatinWord(value: string) {
  return /[A-Za-z]{3,}/u.test(value);
}

/**
 * \u53ef\u8bfb\u6027\u63a8\u8350\u4e0a\u9650\uff08A10\uff0c2026-09-09\uff09\u3002
 *
 * \u4e0e `slot.maxLength` \u662f**\u4e24\u4e2a\u4e0d\u540c\u7ea6\u675f**\uff0c\u5fc5\u987b\u5e76\u5b58\uff08\u7ea2\u961f\u4fee\u6b63\uff09\uff1a
 * - `maxLength` = schema \u786c\u4e0a\u9650\uff08`hero.title` 160 \u5b57\uff09\uff0c\u8d85\u4e86\u5b58\u4e0d\u4e0b/\u7834\u7248\uff1b
 * - \u672c\u8868 = \u53ef\u8bfb\u6027\u63a8\u8350\u503c\uff0c\u8d85\u4e86\u8bfb\u7740\u7d2f\uff0c\u4f46\u6a21\u677f\u88c5\u5f97\u4e0b\u3002
 *
 * \u4e2d\u6587\u5bb9\u91cf\u7cfb\u6570 0.9\uff1a\u4e2d\u6587\u4fe1\u606f\u5bc6\u5ea6\u9ad8\u4e8e\u82f1\u6587\uff0c\u540c\u6837\u7684\u89c6\u89c9\u5bbd\u5ea6\u80fd\u88c5\u7684\u6c49\u5b57\u66f4\u5c11\u3002
 * \u6b64\u524d\u8be5\u7cfb\u6570\u53ea\u5199\u5728\u63d0\u793a\u8bcd\u91cc\uff08"\u4e2d\u6587\u6309\u6a21\u677f\u5bb9\u91cf\u00d70.9"\uff09\uff0c\u4ee3\u7801\u4fa7\u6ca1\u6709\u5bf9\u5e94\u6821\u9a8c\u2014\u2014
 * \u63d0\u793a\u8bcd\u8bf4\u4e86\u4f46\u6ca1\u4eba\u68c0\u67e5 = \u767d\u8bf4\u3002
 */
/**
 * 可读性建议线不再单独维护（2026-09-12 删除 `COPY_READABILITY`）。
 *
 * ## 为什么删掉一个不是坏东西的常量
 *
 * 它表达的是"读着累"这种**软偏好**，本身没错。问题是它**有两个消费者，而两边语义相反**：
 *  - `checkCopyLength` 拿它**硬拒写入**（写不进草稿）；
 *  - `policyRulesText()` 拿它**写进提示词**，告诉模型"说明≤40汉字/25词"。
 *
 * 于是它实际成了**第二套契约**：模型照着 40 写、稍有发挥就被拒，
 * 而模板真实容量是 800。两条规则打架，输的永远是用户——
 * 真机实测（2026-09-12）：`about.body` 连续 4 次被拒（58/60/64/94 字），
 * 「公司简介」这个字段**永远写不进去**，草稿里留着 Forge 演示文案并被**发布给了访客**。
 *
 * ## 现在的规则（一套，无重复）
 *
 * 长度只有**一个事实源**：模板契约的 `slot.maxLength`（见 `template-slot-contract.ts`）。
 *  - **写不进、发不出** → 只由它决定（`checkCopyLength` 与 `exceedsCopyLimit` 读同一处）；
 *  - **读着累** → 不再是独立常量，而是**由容量派生**的提示比例（见 `POLISH_RATIO`）。
 *
 * 这样"契约改一处，提示词、写入闸、发布门一起跟着变"——不会再出现两套数字互相打架。
 */

function exceedsCopyLimit(slot: TemplateSlotBinding, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  /**
   * \u786c\u7ebf**\u53ea\u6709\u4e00\u4e2a**\uff1a\u6a21\u677f\u5951\u7ea6\u7684 `maxLength`\uff08\u5b57\u7b26\u6570\uff09\u3002
   *
   * 2026-09-12 \u771f\u673a\u5b9e\u6d4b\u6539\u3002\u6b64\u524d\u8fd9\u91cc\u8fd8\u53e0\u4e86\u4e00\u6761**\u53ef\u8bfb\u6027**\u8f6f\u7ebf
   * \uff08`COPY_READABILITY` \u7684 40 \u6c49\u5b57 / 25 \u8bcd\uff09\uff0c\u547d\u4e2d\u7684\u69fd\u4f4d\u4f1a\u8fdb `overLimitSlots`\uff0c
   * \u800c `over_limit` \u5728\u7b56\u7565\u6811\u91cc\u662f **`severity: "block"`** \u2014\u2014\u4e8e\u662f\u90a3\u6761"\u8f6f"\u7ebf
   * \u5b9e\u9645\u4e0a\u662f\u7b2c\u4e8c\u9053\u53d1\u5e03\u95e8\uff1aAI \u6309\u63d0\u793a\u8bcd\u5199\u3001\u8bfb\u7740\u5b8c\u5168\u6b63\u5e38\u7684 58\u201394 \u5b57 `about.body`
   * \u65e2\u5199\u4e0d\u8fdb\u8349\u7a3f\uff08`checkCopyLength` \u62e6\uff09\uff0c\u4e5f\u53d1\u4e0d\u51fa\u53bb\uff08\u8fd9\u91cc\u62e6\uff09\u3002
   *
   * \u4e00\u6761\u53ef\u8bfb\u6027\u5efa\u8bae\u4e0d\u8be5\u51b3\u5b9a"\u80fd\u4e0d\u80fd\u53d1\u5e03"\u3002\u73b0\u5728\uff1a
   *  - **\u5199\u4e0d\u8fdb / \u53d1\u4e0d\u51fa** \u53ea\u7531 `maxLength`\uff08\u6a21\u677f\u771f\u5b9e\u5bb9\u91cf\uff09\u51b3\u5b9a \u2014\u2014 **\u52a8\u6001\uff0c\u968f\u6a21\u677f\u8d70**\uff1b
   *  - **\u8bfb\u7740\u7d2f** \u4f5c\u4e3a\u63d0\u793a\u53e6\u8d70\u4e00\u5904\uff0c\u4e0d\u518d\u5192\u5145\u53d1\u5e03\u95e8\u3002
   *
   * \u539f\u5148\u90a3\u6761\u8f6f\u7ebf\u91cc\u5bf9\u82f1\u6587\u7528"\u8bcd\u6570"\u5224\uff0825 \u8bcd vs 800 \u5b57\u7b26\u5bb9\u91cf\uff09\u672c\u8eab\u5c31\u4e0d\u540c\u91cf\u7eb2\uff0c
   * \u62ff\u5b83\u6bd4\u5bb9\u91cf\u6c38\u8fdc\u5224\u4e0d\u8d85\uff0c\u7b49\u4e8e\u8be5\u9632\u7684\u6ca1\u9632\u3001\u4e0d\u8be5\u62e6\u7684\u4e71\u62e6\u3002
   */
  return Array.from(trimmed).length > slot.maxLength;
}

function collectOverLimitSlots(draft: SiteDraft, manifest: TemplateManifest) {
  const result = new Set<string>();
  for (const slot of manifest.slots) {
    const locales = slot.locales.length ? slot.locales : [draft.locale];
    for (const locale of locales) {
      const values = targetValues(draft, slot.target, locale);
      if (values.some((value) => exceedsCopyLimit(slot, value))) {
        result.add(slot.target);
        break;
      }
    }
  }
  return [...result];
}

function collectPlaceholders(
  draft: SiteDraft,
  manifest: TemplateManifest,
) {
  const result = new Set<string>();
  const tolerant = new Set(getPlaceholderTolerantSemanticTypes());
  for (const slot of manifest.slots) {
    // 只认"企业事实类"槽位上的诚实占位；创意文案槽位出现"待补充"属没干活（按缺口计）
    if (!tolerant.has(slot.semanticType)) continue;
    const locales = slot.locales.length ? slot.locales : (["zh", "en"] as const);
    const values = locales.flatMap((locale) => targetValues(draft, slot.target as QualityTarget, locale));
    if (values.some((value) => isPlaceholderValue(value))) result.add(slot.target);
  }
  return [...result];
}

function collectLanguageMismatches(
  draft: SiteDraft,
  manifest: TemplateManifest,
  skipTargets: readonly string[] = [],
) {
  const result = new Set<string>();
  if (draft.locale !== "zh" && draft.locale !== "en") return [];
  const skip = new Set(skipTargets);
  const slots: Array<TemplateSlotBinding | { target: QualityTarget; locales: readonly Locale[] }> = [
    ...manifest.slots,
    { target: "hero.subtitle", locales: ["zh", "en"] },
  ];
  for (const slot of slots) {
    if (NON_LOCALIZED_TARGETS.has(slot.target)) continue;
    if (skip.has(slot.target)) continue;
    const values = targetValues(draft, slot.target, draft.locale);
    values.forEach((value) => {
      const trimmed = value.trim();
      if (!trimmed || isNonCopyValue(trimmed)) return;
      if (draft.locale === "zh" && !hasCjk(trimmed) && hasLatinWord(trimmed)) result.add(`${slot.target}.zh`);
      if (draft.locale === "en" && hasCjk(trimmed) && !hasLatinWord(trimmed)) result.add(`${slot.target}.en`);
    });
  }
  return [...result];
}

function collectMetaCommentary(draft: SiteDraft, manifest: TemplateManifest) {
  const result = new Set<string>();
  for (const slot of manifest.slots) {
    const locales = slot.locales.length ? slot.locales : (["zh", "en"] as const);
    const values = locales.flatMap((locale) => targetValues(draft, slot.target as QualityTarget, locale));
    // 只挑"不是纯标记、却含说明句式"的——纯标记（"地址待补充"）走 placeholder 路径
    if (values.some((value) => value.trim() && !isPlaceholderValue(value) && META_COMMENTARY_PATTERN.test(value))) {
      result.add(slot.target);
    }
  }
  return [...result];
}

export function evaluateDraftQuality(
  draft: SiteDraft,
  manifest: TemplateManifest,
  options: QualityOptions = {},
): ContentQualityReport {
  const coverage = classifyDraftCoverage({ draft, manifest, appliedTargets: options.appliedTargets ?? [] });
  const requiredTargets = new Set<string>(manifest.slots.filter((slot) => slot.required).map((slot) => slot.target));
  /**
   * 用户**主动隐藏**的板块不算缺口（2026-09-10）。
   *
   * 生成链路早就是这个语义：`buildGenerationPlan` 把 `hiddenSections` 从待生成板块里剔除
   * （否则会催 AI 给一个已被隐藏的板块写内容）。但质检器此前不认这个事实——
   * 用户隐藏「产品」后仍被要求填商品，**发布被拦在一个他明确说不要的板块上**。
   *
   * 此前未暴露，是因为默认草稿预置了 3 个演示商品（`starterProducts`）把这一格填住了；
   * 2026-09-10 移除预置演示商品后（避免成品站显示别人的产品）该缺陷才显形。
   */
  const hidden = new Set<string>(draft.hiddenSections ?? []);
  const isSkipped = (target: string) => hidden.has(target.split(".")[0] ?? "");
  // 缺口 = 契约要求却无法映射 + 空值/模板残留（该写没写）；已隐藏的板块不计
  const missingSlots = [...new Set([
    ...coverage.unmappedRequiredTargets,
    ...coverage.pendingTargets.filter((target) => requiredTargets.has(target)),
  ])].filter((target) => !isSkipped(target));
  // 伪造内容（example.com / lorem）比缺失更糟：访客会当真信息，必须阻断
  const fabricatedTargets = [...new Set(coverage.fabricatedTargets)];
  // 元说明（把缺口标记写成访客可见的句子）——阻断，让 AI 重写
  const metaCommentaryTargets = collectMetaCommentary(draft, manifest);
  // 事实缺失（"待补充"）：不阻断发布（发布时隐藏该字段），只提示补齐
  const placeholderTargets = collectPlaceholders(draft, manifest);
  const overLimitSlots = collectOverLimitSlots(draft, manifest);
  // 语言不匹配对占位槽跳过——"待补充"没有语言可言，不该二次扣分
  const languageMismatches = collectLanguageMismatches(draft, manifest, placeholderTargets);
  const unverifiedFacts = [...new Set(checkDraftFacts(textForFacts(draft), options.factReference).map((claim) => `${claim.raw}（${claim.source}）`))];
  // 分数与放行决策**从策略树派生**（lib/content-policy.ts 是单一真相源）：
  // 权重改在策略树里，提示词文本与发布门自动跟上。
  const counts: PolicyCounts = {
    fabricated: fabricatedTargets.length,
    missing: missingSlots.length,
    meta_commentary: metaCommentaryTargets.length,
    over_limit: overLimitSlots.length,
    language_drift: languageMismatches.length,
    fact_gap: placeholderTargets.length,
    unverified_fact: unverifiedFacts.length,
  };
  return {
    missingSlots,
    fabricatedTargets,
    metaCommentaryTargets,
    placeholderTargets,
    overLimitSlots,
    languageMismatches,
    unverifiedFacts,
    counts,
    score: qualityScore(counts),
    // 未确认事实属"用户可豁免"——此处按未确认处理（发布门会按 factsConfirmed 重算）
    publishable: policyDecision(counts).allowed,
  };
}
