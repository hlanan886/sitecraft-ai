import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const astrofyManifest: TemplateManifest = {
  templateId: "astrofy",
  displayName: "ASTROFY / Portfolio",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Astrofy", "Hey there", "I'm Manuel Ernesto", "Demo Project"],
    }),
  presentation: [
    {
      slot: "about",
      role: "split_text_media",
      presentAs: "个人简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "Astrofy intro 区块",
    },
    {
      slot: "features",
      role: "product_grid",
      presentAs: "作品项目卡流，最多 6 条",
      capacity: { min: 1, default: 4, max: 6 },
      itemShape: "title_body",
      anchor: "main 内原生项目卡",
    },
    {
      slot: "contact",
      role: "split_text_media",
      presentAs: "联系区块：标题与说明",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#contact",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

