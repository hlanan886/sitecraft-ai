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

/**
 * 从**流式仍未闭合的 JSON** 中提取「已经写完的可读片段」，用于实时展示。
 *
 * 背景（2026-09-10 用户要求「以流式输出为主提升用户体验」）：
 * 生成阶段此前只推「已输出 N 字」——用户干等 30-90s 看不到任何内容。
 * 但模型的输出是结构化 JSON（`{"operations":[{"op":"set_text","value":"…"}…]}`），
 * 直接推原始增量没有可读性（全是 `{"op":"set_` 之类）。
 *
 * 做法：只取**已闭合的字符串字面量**——正则要求开引号与闭引号都在，天然跳过正在写的那个值，
 * 避免把半截文字（"精密制"）当完整内容显示造成的跳变。再按「长得像正文」过滤：
 * 长度 ≥ 8、含中日韩字符或空格（排除 `set_text` / `hero.title` / `zh` 这类标识符）。
 *
 * 返回最近 `limit` 条（最新在后），调用方拼成一行显示。
 */
export function extractStreamingSnippets(text: string, limit = 2): string[] {
  if (!text) return [];
  const snippets: string[] = [];
  // 已闭合的 JSON 字符串字面量：开引号 + 非引号非换行内容 + 闭引号
  const closed = /"((?:[^"\\\n]|\\.){2,})"/g;
  let match: RegExpExecArray | null;
  while ((match = closed.exec(text)) !== null) {
    const raw = match[1];
    // 反斜杠转义（\n / \" / \uXXXX）说明还在结构化数据里，跳过；正文里几乎不出现裸反斜杠
    if (raw.includes("\\")) continue;
    const value = raw.trim();
    if (value.length < 8) continue;
    // 必须像"人话"：含中日韩字符，或含空格的多词英文句子
    const looksLikeProse = /[㐀-鿿]/.test(value) || /\s/.test(value);
    if (!looksLikeProse) continue;
    // 排除 JSON 键名/枚举/操作名等标识符形态
    if (/^[a-z_]+(\.[a-z_]+)*$/i.test(value)) continue;
    snippets.push(value);
  }
  return snippets.slice(-limit);
}

/** 把流式片段拼成一句进度文案（无可用片段时返回 null，调用方回退到"已输出 N 字"）。 */
export function formatStreamingPreview(snippets: readonly string[]): string | null {
  const cleaned = snippets.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!cleaned.length) return null;
  const joined = cleaned.join(" … ");
  return `正在生成：${joined.length > 46 ? `${joined.slice(0, 46)}…` : joined}`;
}
