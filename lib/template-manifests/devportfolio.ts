import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const devportfolioManifest: TemplateManifest = {
  templateId: "devportfolio",
  displayName: "DEVPORTFOLIO / Profile",
  manifestVersion: 1,
  runtime: "static-html",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({}, {
    // devportfolio 的 hero h1 位于 main/header 之外的 section/div 内（static 布局），
    // 默认 "main h1, header h1" 采集不到，放宽到页面首个非 sr-only h1。
    "hero.title": "main h1, header h1, body > h1, section h1",
  }),
  presentation: [
    {
      slot: "about",
      role: "split_text_media",
      presentAs: "个人简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#about",
    },
    {
      slot: "features",
      role: "product_grid",
      presentAs: "作品项目卡网格，最多 6 条",
      capacity: { min: 1, default: 4, max: 6 },
      itemShape: "title_body",
      anchor: "#projects 内 .group.relative 项目卡",
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

