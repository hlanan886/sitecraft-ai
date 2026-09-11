import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const landwindManifest: TemplateManifest = {
  templateId: "landwind",
  displayName: "LANDWIND / Clean",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Building digital products & brands", "Landwind"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      slot: "hero",
      role: "hero_split_image",
      presentAs: "首屏：左主标题+说明+按钮、右产品/场景图（Flowbite 左右分栏 hero）。标题用一句话产品/能力主张，说明两句内。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "含 h1 的首个 section（bg-gray-50 或 bg-white 且右侧含 img）",
    },
    {
      slot: "about",
      role: "split_text_media",
      presentAs: "关于：沿用原生图文分栏（h2+p+勾选列），分栏首行承载企业简介一句话。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "lg:grid-cols-2 且含 h2+ul 的分栏",
    },
    {
      slot: "features",
      role: "split_text_media",
      presentAs: "核心价值：原生第 1 组图文分栏（标题+说明+勾选列 li>span 短句）。每条一行价值点，建议 2-3 条（勾选列原生 3 点），不必为凑数加卡。",
      capacity: { min: 2, default: 3, max: 3 },
      itemShape: "title_body",
      anchor: "lg:grid-cols-2 分栏行 0 内 ul[role=list]>li>span",
    },
    {
      slot: "services",
      role: "split_text_media",
      presentAs: "服务能力：原生第 2 组图文分栏（标题+说明+勾选列 li>span 短句）。建议 2-3 条（原生 5 点容量），写具体服务条目短句。",
      capacity: { min: 2, default: 3, max: 5 },
      itemShape: "title_body",
      anchor: "lg:grid-cols-2 分栏行 1 内 ul[role=list]>li>span",
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

