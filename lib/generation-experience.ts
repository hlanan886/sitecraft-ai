import type { Locale } from "./site-model.ts";
import { isTemplateRecommendationEligible, supportsTemplateLocale } from "./template-manifest.ts";

const FAQ_SECTION_LIMIT = "不支持独立常见问题板块，可在联系页或产品页中以折叠文本形式嵌入常见问题，或改用询盘表单替代";

type RecommendationTemplate = {
  id: string;
  category: string;
};

type RecommendationIntent = {
  recommendedTemplateId?: string;
  businessType?: string;
  industry?: string;
  targetAudience?: string;
  tone?: string;
  summary?: string;
};

type RecommendationOptions<T> = {
  isEligible?: (template: T) => boolean;
  locale?: Locale;
};

type AdaptableIntent = {
  coreSections: string[];
  notices?: string[];
  limits?: string[];
};

type GenerationProgressInput = {
  phase: "content" | "review" | "saving";
  sections: string[];
  completedSections: string[];
  failedSections: string[];
  elapsedMs: number;
  terminal?: boolean;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate<T>(items: T[], offset: number) {
  if (items.length < 2) return items;
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export function buildTemplateRecommendations<T extends RecommendationTemplate>(
  templates: readonly T[],
  intent: RecommendationIntent | null,
  options: RecommendationOptions<T> = {},
) {
  const eligible = templates.filter(
    (template) =>
      (options.isEligible?.(template) ?? true) &&
      isTemplateRecommendationEligible(template.id) &&
      (!options.locale || supportsTemplateLocale(template.id, options.locale)),
  );
  if (!eligible.length) return [];

  const requestedPrimary = eligible.find((template) => template.id === intent?.recommendedTemplateId);
  const primary = requestedPrimary ?? eligible[0];
  const seed = [intent?.businessType, intent?.industry, intent?.targetAudience, intent?.tone, intent?.summary]
    .filter(Boolean)
    .join("|");
  const hash = stableHash(seed || primary.id);
  const sameCategory = rotate(
    eligible.filter((template) => template.id !== primary.id && template.category === primary.category),
    hash,
  );
  const crossCategory = rotate(
    eligible.filter((template) => template.id !== primary.id && template.category !== primary.category),
    Math.floor(hash / 97),
  );

  const recommendations: T[] = [primary];
  const add = (candidate: T | undefined) => {
    if (candidate && !recommendations.some((template) => template.id === candidate.id)) recommendations.push(candidate);
  };
  add(sameCategory[0]);
  add(crossCategory[0]);
  for (const candidate of [...sameCategory.slice(1), ...crossCategory.slice(1), ...eligible]) {
    if (recommendations.length >= 3) break;
    add(candidate);
  }
  return recommendations.slice(0, 3);
}

export function adaptIntentLimits<T extends AdaptableIntent>(intent: T): T {
  const limits = intent.limits ?? [];
  if (!limits.some((limit) => limit.trim() === FAQ_SECTION_LIMIT)) return intent;

  const adaptation = "已自动把常见问题合并到联系板块，并保留询盘表单作为转化入口。";
  return {
    ...intent,
    coreSections: intent.coreSections.includes("contact") ? intent.coreSections : [...intent.coreSections, "contact"],
    notices: [...(intent.notices ?? []), adaptation],
    limits: limits.filter((limit) => limit.trim() !== FAQ_SECTION_LIMIT),
  };
}

export function getGenerationProgress(input: GenerationProgressInput) {
  if (input.terminal) return 100;
  const sectionCount = Math.max(1, new Set(input.sections).size);
  const resolvedCount = new Set([...input.completedSections, ...input.failedSections]).size;
  const sectionProgress = Math.min(1, resolvedCount / sectionCount) * 80;
  const phaseFloor = input.phase === "saving" ? 92 : input.phase === "review" ? 84 : 4;
  const timeSupplement = Math.min(4, Math.max(0, input.elapsedMs) / 55_000 * 4);
  return Math.min(96, Math.round(Math.max(sectionProgress, phaseFloor) + timeSupplement));
}

export function formatGenerationProgress(value: number) {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}
