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
      slot: "about",
      role: "split_text_media",
      presentAs: "博客简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "首页轮播后的简介区",
    },
    {
      slot: "features",
      role: "card_grid",
      presentAs: "文章卡流，最多 8 条",
      capacity: { min: 1, default: 6, max: 8 },
      itemShape: "title_body",
      anchor: "main 内 .onload-animation 文章卡",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

