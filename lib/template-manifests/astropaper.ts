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
      slot: "about",
      role: "split_text_media",
      presentAs: "博客简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#about",
    },
    {
      slot: "features",
      role: "card_grid",
      presentAs: "最新文章列表，最多 8 条",
      capacity: { min: 1, default: 6, max: 8 },
      itemShape: "title_body",
      anchor: "#recent-posts li",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

