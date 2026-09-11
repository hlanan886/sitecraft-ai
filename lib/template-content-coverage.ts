import { defaultDraft, type Locale, type SiteDraft } from "./site-document.ts";
import type { TemplateContentTarget, TemplateManifest } from "./template-manifest.ts";

export type ContentCoverageReport = {
  filledTargets: string[];
  aiFilledTargets: string[];
  pendingTargets: string[];
  residualDemoSlots: string[];
  unmappedRequiredTargets: string[];
};

type VisibleTextsBySlot = Readonly<Record<string, string | readonly string[] | undefined>>;

function targetValues(draft: SiteDraft, target: string, locale: Locale): string[] | undefined {
  switch (target) {
    case "hero.title":
      return [draft.content.hero.title[locale]];
    case "about.body":
      return [draft.content.about.body[locale]];
    case "features.items":
      return draft.content.features.items.flatMap((item) => [item.title[locale], item.body[locale]]);
    case "services.items":
      return draft.content.services.items.flatMap((item) => [item.title[locale], item.body[locale]]);
    case "products":
      return draft.products.flatMap((product) => [product.name[locale], product.summary[locale], product.category]);
    case "contact.title":
      return [draft.content.contact.title[locale]];
    case "contact.body":
      return [draft.content.contact.body[locale]];
    case "contact.email":
      return [draft.content.contact.email];
    case "contact.phone":
      return [draft.content.contact.phone];
    case "contact.address":
      return [draft.content.contact.address[locale]];
    default:
      return undefined;
  }
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

const pendingPattern = /(?:\blorem\s+ipsum\b|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon|待补充|暂无|敬请期待|example\.com)/i;

function hasPendingValue(values: readonly string[]) {
  return values.length === 0 || values.some((value) => !normalize(value) || pendingPattern.test(value));
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
    residualDemoSlots: [],
    unmappedRequiredTargets: [],
  };
  const seen = new Set<string>();

  for (const slot of args.manifest.slots) {
    if (seen.has(slot.target)) continue;
    seen.add(slot.target);
    const values = targetValues(args.draft, slot.target, args.draft.locale);
    if (!values) {
      if (slot.required) report.unmappedRequiredTargets.push(slot.target);
      continue;
    }

    const defaultValues = targetValues(defaultDraft, slot.target, args.draft.locale) ?? [];
    const hasDemoResidue = containsFingerprint(values, slot.demoFingerprints);
    if (hasDemoResidue) report.residualDemoSlots.push(slot.target);

    if (hasPendingValue(values) || sameValues(values, defaultValues) || hasDemoResidue) {
      report.pendingTargets.push(slot.target);
      continue;
    }

    if (targetWasApplied(slot.target, args.appliedTargets)) report.aiFilledTargets.push(slot.target);
    else report.filledTargets.push(slot.target);
  }

  return report;
}
