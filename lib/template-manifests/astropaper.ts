import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const astropaperManifest: TemplateManifest = {
  templateId: "astropaper",
  displayName: "ASTROPAPER / Knowledge",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["AstroPaper"],
    }),
  presentation: [
    {
      presentationSlot: "contact",
      role: "split_text_media",
      presentAs: "联系：博客无联系区，由通用区承载。写联系方式。",
      nativeFallbackHost: "generated",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成联系区",
    },
    {
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "文章列表：博客文章网格（#recent-posts，标题 + 摘要 + 日期）。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "section#recent-posts 或 #featured",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      presentAs: "分类/专题：博客无服务区，由通用区承载（可写内容分类）。建议 2-4 条。",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "通用生成区",
    },
    {
      presentationSlot: "hero",
      role: "hero_centered",
      presentAs: "首屏：博客标题 + 一句副文（#hero 区，简洁）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "section#hero",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "博客简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#about",
    },
    {
      presentationSlot: "features",
      role: "card_grid",
      nativeFallbackHost: "generated",
      presentAs: "最新文章列表，最多 8 条",
      capacity: { min: 1, default: 6, max: 8 },
      itemShape: "title_body",
      anchor: "#recent-posts li",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

