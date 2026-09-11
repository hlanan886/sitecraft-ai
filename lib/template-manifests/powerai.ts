import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const poweraiManifest: TemplateManifest = {
  templateId: "powerai",
  displayName: "GENAI / AI Company",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Build the Future with GenAI"],
      "contact.title": ["Start Building Today"],
      "contact.email": ["hello@aiagentplatform.com"],
      "contact.body": ["Join thousands of teams"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      slot: "hero",
      role: "hero_centered",
      presentAs: "首屏：深色渐变光斑背景 + 居中大标题（可含渐变强调 span）+ 副文 + 单一 CTA 胶囊按钮。标题一句话主张（企业/行业），副文一两句。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "main 首屏 section（.relative.overflow-hidden，内含 h1 与绝对定位 animate-blob 光斑，无 id）",
    },
    {
      slot: "features",
      role: "card_grid",
      presentAs: "产品方案/核心能力：原生 #features 网格 6 张带渐变图标的圆角边框卡（div.group.p-6.rounded-2xl.border.bg-card：渐变 inline-flex 图标 + h3 标题 + p 正文，md:2 / lg:3 列）。恰好 6 条填满；图标由模板自带，AI 只填 h3/p 中文。",
      capacity: { min: 2, default: 6, max: 6 },
      itemShape: "title_body",
      anchor: "id=features 的 section 内 lg:grid-cols-3 网格的 div.group（rounded-2xl border bg-card + inline-flex 渐变 icon）",
    },
    {
      slot: "services",
      role: "card_grid",
      presentAs: "服务支持：无原生独立服务区，由通用生成服务卡区承载（深色卡片）；建议 2-3 条。",
      capacity: { min: 2, default: 3, max: 12 },
      itemShape: "title_body",
      anchor: "通用生成服务区",
    },
    {
      slot: "products",
      role: "product_grid",
      presentAs: "产品中心：无原生产品卡位，由通用产品网格承载（SKU+简介+图，深色卡片，3 列）；建议 6 条。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "通用生成产品网格",
    },
    {
      slot: "contact",
      role: "split_text_media",
      presentAs: "联系板块：无原生联系区，由通用生成区承载（标题+正文+邮箱/电话/地址，深色渐变底）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成联系区",
    },
  ],
  recommendation: "eligible",
};
