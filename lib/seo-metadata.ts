/**
 * 发布页 SEO 元数据派生（A11，2026-09-09）。
 *
 * 此前发布页只有客户端组件，**没有任何 title/description/OG 标签**——
 * 分享链接没有预览、搜索引擎抓不到摘要。这里从发布快照派生元数据，
 * 由 `app/published/[siteKey]/page.tsx` 的 `generateMetadata` 消费。
 *
 * 纯函数、无副作用：便于离线单测（发布页本身是客户端组件，e2e 只能验渲染）。
 */
import type { Locale, SiteDraft } from "./site-model.ts";

/** 占位/缺口标记：这些值不能作为 SEO 摘要（会出现在搜索结果里）。 */
const NON_COPY_PATTERN = /(?:待补充|暂无|敬请期待|\b(?:tbd|todo)\b|to come|example\.com|lorem ipsum)/i;

export type SeoMetadata = {
  title: string;
  description: string;
  /** OG/社交分享标题（与 title 同源，便于将来分语言） */
  ogTitle: string;
  ogDescription: string;
};

function clean(value: string | undefined | null): string {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  return NON_COPY_PATTERN.test(trimmed) ? "" : trimmed;
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * 从草稿派生 SEO 元数据。
 * @param draft 发布快照里的草稿
 * @param locale 站点语言（决定取哪一份文案）
 */
export function deriveSeoMetadata(draft: SiteDraft, locale: Locale = "zh"): SeoMetadata {
  const company = clean(draft.companyName) || clean(draft.siteName) || "企业官网";
  const industry = clean(draft.industry);
  const heroTitle = clean(draft.content.hero.title[locale]) || clean(draft.content.hero.title.zh);
  const heroSubtitle = clean(draft.content.hero.subtitle[locale]) || clean(draft.content.hero.subtitle.zh);
  const aboutBody = clean(draft.content.about.body[locale]) || clean(draft.content.about.body.zh);
  const goal = clean(draft.goal);

  // 标题：公司名 + 主张（避免只有一个泛化公司名）
  const titleParts = [company, heroTitle].filter(Boolean);
  const title = truncate([...new Set(titleParts)].join(" | "), 60);

  // 描述：优先副标题（一句话主张），其次公司简介，最后建站目标
  const description = truncate(heroSubtitle || aboutBody || goal || `${company}${industry ? ` · ${industry}` : ""}`, 160);

  return {
    title,
    description,
    ogTitle: title,
    ogDescription: description,
  };
}
