import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const signalManifest: TemplateManifest = {
  templateId: "signal",
  displayName: "RICOFAST / SaaS (signal)",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Ship your SaaS site in days, not weeks", "RicoFast"],
      "about.body": ["Lighthouse 95+"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      slot: "hero",
      role: "hero_centered",
      presentAs: "首屏：单栏居中大标题 + 一句副文 + 主按钮（右侧 SaaS dashboard mock / GitHub·Twitter 按钮已删）。标题一句话主张，副文一句到两句。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "body 直系 hero 块 div.site-container（内含 h1，标题由 animated-text 拆词，适配层先归并为单行文本）",
    },
    {
      slot: "features",
      role: "card_grid",
      presentAs: "核心优势：原生 6 图标卡网格（lg:grid-cols-3，每卡 img 图标 + h3 标题 + p 正文），图标保留；恰好 6 条填满，每卡标题简短、正文一句。",
      capacity: { min: 2, default: 6, max: 6 },
      itemShape: "title_body",
      anchor: "「Everything you need」6 卡区（section，标题 .animated-text；内层卡 div > img + h3 + p）",
    },
    {
      slot: "services",
      role: "card_grid",
      presentAs: "服务支持：原生无独立服务区，由通用服务卡区承载；建议 2-3 条。",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "通用生成服务区",
    },
    {
      slot: "products",
      role: "product_grid",
      presentAs: "产品中心：无原生产品卡位，由通用产品网格承载（SKU+简介+图，浅色面板 3 列）。",
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
