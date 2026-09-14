import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const yukinaManifest: TemplateManifest = {
  templateId: "yukina",
  displayName: "YUKINA / Editorial Blog",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Yukina", "Ad Astra Per Aspera"],
    }),
  presentation: [
    {
      presentationSlot: "contact",
      role: "split_text_media",
      presentAs: "联系：博客无联系区，由通用区承载。",
      nativeFallbackHost: "generated",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成联系区",
    },
    {
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "文章列表：博客文章网格。",
      nativeFallbackHost: "generated",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "通用生成区",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      presentAs: "专题/栏目：博客无服务区，由通用区承载。建议 2-4 条。",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "通用生成区",
    },
    {
      presentationSlot: "hero",
      role: "hero_centered",
      presentAs: "首屏：博客/杂志标题 + 一句副文。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "首个可见 h1",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "博客简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "首页轮播后的简介区",
    },
    {
      presentationSlot: "features",
      role: "card_grid",
      nativeFallbackHost: "generated",
      presentAs: "文章卡流，最多 8 条",
      capacity: { min: 1, default: 6, max: 8 },
      itemShape: "title_body",
      anchor: "main 内 .onload-animation 文章卡",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

