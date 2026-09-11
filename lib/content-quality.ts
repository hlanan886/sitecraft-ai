import { checkDraftFacts } from "./fact-check.ts";
import { classifyDraftCoverage } from "./template-content-coverage.ts";
import type { Locale, SiteDraft } from "./site-document.ts";
import type { TemplateContentTarget, TemplateManifest, TemplateSlotBinding } from "./template-manifest.ts";

export type ContentQualityReport = {
  missingSlots: string[];
  overLimitSlots: string[];
  placeholderHits: string[];
  languageMismatches: string[];
  unverifiedFacts: string[];
  score: number;
  publishable: boolean;
};

type QualityOptions = {
  factReference?: string;
};

const PLACEHOLDER_PATTERN = /(?:\blorem\s+ipsum\b|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon|待补充|暂无|敬请期待|example\.com)/i;
type QualityTarget = TemplateContentTarget | "hero.subtitle";

const NON_LOCALIZED_TARGETS = new Set<QualityTarget>([
  "contact.email",
  "contact.phone",
]);

function targetValues(draft: SiteDraft, target: QualityTarget, locale: Locale): string[] {
  switch (target) {
    case "hero.title": return [draft.content.hero.title[locale]];
    case "hero.subtitle": return [draft.content.hero.subtitle[locale]];
    case "about.body": return [draft.content.about.body[locale]];
    case "features.items": return draft.content.features.items.flatMap((item) => [item.title[locale], item.body[locale]]);
    case "services.items": return draft.content.services.items.flatMap((item) => [item.title[locale], item.body[locale]]);
    case "products": return draft.products.flatMap((product) => [product.name[locale], product.summary[locale], product.category]);
    case "contact.title": return [draft.content.contact.title[locale]];
    case "contact.body": return [draft.content.contact.body[locale]];
    case "contact.email": return [draft.content.contact.email];
    case "contact.phone": return [draft.content.contact.phone];
    case "contact.address": return [draft.content.contact.address[locale]];
  }
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

function exceedsCopyLimit(slot: TemplateSlotBinding, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (Array.from(trimmed).length > slot.maxLength) return true;
  if (slot.target.endsWith(".title")) {
    const chineseLength = (trimmed.match(/[\u3400-\u9fff]/gu) ?? []).length;
    const englishWords = trimmed.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/gu)?.length ?? 0;
    return chineseLength > 15 || englishWords > 10;
  }
  if (slot.target.endsWith(".body")) {
    const chineseLength = (trimmed.match(/[\u3400-\u9fff]/gu) ?? []).length;
    const englishWords = trimmed.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/gu)?.length ?? 0;
    return chineseLength > 40 || englishWords > 25;
  }
  return false;
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

function collectPlaceholders(draft: SiteDraft, manifest: TemplateManifest, pendingSlots: readonly string[]) {
  const result = new Set<string>();
  for (const slot of manifest.slots) {
    const values = slot.locales.flatMap((locale) => targetValues(draft, slot.target, locale));
    if (values.some((value) => PLACEHOLDER_PATTERN.test(value))) result.add(slot.target);
  }
  pendingSlots.forEach((slot) => {
    if (manifest.slots.some((candidate) => candidate.target === slot)) {
      const target = manifest.slots.find((candidate) => candidate.target === slot)!;
      const values = target.locales.flatMap((locale) => targetValues(draft, target.target, locale));
      if (values.some((value) => PLACEHOLDER_PATTERN.test(value))) result.add(slot);
    }
  });
  return [...result];
}

function collectLanguageMismatches(draft: SiteDraft, manifest: TemplateManifest) {
  const result = new Set<string>();
  if (draft.locale !== "zh" && draft.locale !== "en") return [];
  const slots: Array<TemplateSlotBinding | { target: QualityTarget; locales: readonly Locale[] }> = [
    ...manifest.slots,
    { target: "hero.subtitle", locales: ["zh", "en"] },
  ];
  for (const slot of slots) {
    if (NON_LOCALIZED_TARGETS.has(slot.target)) continue;
    const values = targetValues(draft, slot.target, draft.locale);
    values.forEach((value) => {
      const trimmed = value.trim();
      if (!trimmed || PLACEHOLDER_PATTERN.test(trimmed)) return;
      if (draft.locale === "zh" && !hasCjk(trimmed) && hasLatinWord(trimmed)) result.add(`${slot.target}.zh`);
      if (draft.locale === "en" && hasCjk(trimmed) && !hasLatinWord(trimmed)) result.add(`${slot.target}.en`);
    });
  }
  return [...result];
}

export function evaluateDraftQuality(
  draft: SiteDraft,
  manifest: TemplateManifest,
  options: QualityOptions = {},
): ContentQualityReport {
  const coverage = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  const requiredTargets = new Set<string>(manifest.slots.filter((slot) => slot.required).map((slot) => slot.target));
  const missingSlots = [...new Set([
    ...coverage.unmappedRequiredTargets,
    ...coverage.pendingTargets.filter((target) => requiredTargets.has(target)),
  ])];
  const overLimitSlots = collectOverLimitSlots(draft, manifest);
  const placeholderHits = collectPlaceholders(draft, manifest, missingSlots);
  const languageMismatches = collectLanguageMismatches(draft, manifest);
  const unverifiedFacts = [...new Set(checkDraftFacts(textForFacts(draft), options.factReference).map((claim) => `${claim.raw}（${claim.source}）`))];
  const issueCount = missingSlots.length + overLimitSlots.length + placeholderHits.length + languageMismatches.length + unverifiedFacts.length;
  const score = Math.max(0, Math.min(100,
    100
      - missingSlots.length * 12
      - overLimitSlots.length * 8
      - placeholderHits.length * 5
      - languageMismatches.length * 6
      - unverifiedFacts.length * 10,
  ));
  return {
    missingSlots,
    overLimitSlots,
    placeholderHits,
    languageMismatches,
    unverifiedFacts,
    score,
    publishable: issueCount === 0,
  };
}
