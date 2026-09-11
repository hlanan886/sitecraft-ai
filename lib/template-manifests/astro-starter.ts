import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const astroStarterManifest: TemplateManifest = {
  templateId: "astro-starter",
  displayName: "TAILCAST / Startup",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["One platform to track the full picture", "Tailcast"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      slot: "hero",
      role: "hero_centered",
      presentAs: "首屏：居中深色 hero（眉题 + 大标题 + 副文 + 主按钮 + 下方整宽产品截图）。标题一句话主张，说明两句内；保留深色背景与产品图。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "id=home 的 section（h1 下方含 dashboard 大图）",
    },
    {
      slot: "features",
      role: "split_text_media",
      presentAs: "产品方案：原生第 1 组分栏（眉题 + h2.block-big-title 大标题 + intro + 右侧 2x2 图墙 + 左侧勾选列 li>span 短句）。条目为一行价值点（仅标题入列），原生 3 行、可复用同构行容纳至 6 条。",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "id=features 的 section 内 ul>li>span",
    },
    {
      slot: "services",
      role: "split_text_media",
      presentAs: "服务支持：原生第 2 组分栏（图在左 feature5-6 + 右侧眉题 + h2 大标题 + intro + 勾选列 li>span 短句）。条目一行，原生 3 行容量，建议 2-3 条。",
      capacity: { min: 2, default: 2, max: 3 },
      itemShape: "title_body",
      anchor: "#features 后紧邻的 section（block-big-title + ul）",
    },
    {
      slot: "about",
      role: "split_text_media",
      presentAs: "关于板块：无原生 about 区，由通用生成区承载（企业名标题 + 一段公司简介）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成简介区",
    },
    {
      slot: "products",
      role: "product_grid",
      presentAs: "产品中心：无原生产品卡位，由通用产品网格承载（SKU+简介+图，3 列两行）。",
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
