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
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "项目作品：网格条目（#projects，图 + 名称 + 简介）。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "section#projects",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      presentAs: "技能/经历：作品集无服务区，由通用区承载。建议 2-4 条。",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "通用生成区",
    },
    {
      presentationSlot: "hero",
      role: "hero_split_image",
      presentAs: "首屏：头像/图 + 姓名 + 一句话介绍（#hero 区）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "section#hero",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "个人简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#about",
    },
    {
      presentationSlot: "features",
      role: "product_grid",
      presentAs: "作品项目卡网格，最多 6 条",
      capacity: { min: 1, default: 4, max: 6 },
      itemShape: "title_body",
      anchor: "#projects 内 .group.relative 项目卡",
    },
    {
      presentationSlot: "contact",
      role: "split_text_media",
      presentAs: "联系区块：标题与说明",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "#contact",
    },
  ],  nonContentSlots: NON_CONTENT_SLOTS,
  recommendation: "eligible",
};

