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
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "作品/项目：网格条目（#projects/#store，图 + 名称 + 简介）。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "id=projects 或 id=store 区块",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      nativeFallbackHost: "generated",
      presentAs: "服务：作品集的服务列表（#services）。建议 2-4 条，每条一个服务方向 + 一句说明。",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "id=services 区块",
    },
    {
      presentationSlot: "hero",
      role: "hero_centered",
      presentAs: "首屏：作品集标题 + 一句自我介绍（首页 #home 区）。写一句主张 + 一句简介。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "id=home 区块内的标题",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "个人简介：标题与正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "Astrofy intro 区块",
    },
    {
      presentationSlot: "features",
      role: "product_grid",
      presentAs: "作品项目卡流，最多 6 条",
      capacity: { min: 1, default: 4, max: 6 },
      itemShape: "title_body",
      anchor: "main 内原生项目卡",
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

