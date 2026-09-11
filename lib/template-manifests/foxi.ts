import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const foxiManifest: TemplateManifest = {
  templateId: "foxi",
  displayName: "FOXI / SaaS Suite",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Enhance team performance with seamless integration", "Foxi"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      slot: "hero",
      role: "hero_centered",
      presentAs: "首屏：居中大标题（可含强调词）+ 副文 + 主按钮 + 产品界面大图。标题一句话主张，说明两句内。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "id=intro 的 section（lg:col-span-8 居中）",
    },
    {
      slot: "features",
      role: "image_banner",
      presentAs: "核心能力：原生 4 组交替图文横幅（#highlight-0..3，各图+右侧/左侧标题+说明段），建议 4 条正好填满；每条标题简短带要点词。",
      capacity: { min: 2, default: 4, max: 4 },
      itemShape: "title_body",
      anchor: "id=highlight-N 的 4 个 section（text-image__content 内 h2.text-image__heading+p.text-image__text）",
    },
    {
      slot: "services",
      role: "icon_row",
      presentAs: "服务支持：原生无独立服务区，由通用服务卡区承载；建议 3-4 条。",
      capacity: { min: 2, default: 3, max: 4 },
      itemShape: "title_body",
      anchor: "通用生成服务区",
    },
    {
      slot: "products",
      role: "product_grid",
      presentAs: "产品中心：无原生产品卡位，由通用产品网格承载（SKU+简介+图）。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "通用生成产品网格",
    },
    {
      slot: "contact",
      role: "split_text_media",
      presentAs: "联系板块：无原生联系区，由通用生成区承载（标题+正文+邮箱/电话/地址）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成联系区",
    },
  ],
  recommendation: "eligible",
};
