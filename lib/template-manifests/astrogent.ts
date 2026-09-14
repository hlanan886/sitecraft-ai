import type { TemplateManifest } from "./types.ts";
import { ALL_UI_SURFACES, BOTH_LOCALES, NON_CONTENT_SLOTS, contentSlots } from "./shared.ts";

export const astrogentManifest: TemplateManifest = {
  templateId: "astrogent",
  displayName: "ASTROGENT / Agency",
  manifestVersion: 1,
  runtime: "astro-static",
  nativeLocales: ["en"],
  outputLocales: BOTH_LOCALES,
  localizedUi: ALL_UI_SURFACES,
  requiredVisibleTargets: ["heroTitle"],
  slots: contentSlots({
      "hero.title": ["Intelligent AI Agents Built for Your Business", "AI Agent Platform"],
      "contact.title": ["Start Building Today"],
    }),
  nonContentSlots: NON_CONTENT_SLOTS,
  presentation: [
    {
      presentationSlot: "hero",
      role: "hero_centered",
      presentAs: "首屏：居中大标题 + 副文 + 双按钮 + 右侧统计条。模板无 <main>，共享引擎只写标题，副文/CTA 由适配器在 prepare 中文化（保留浅色 mono-mesh 视觉）。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "第一个 body>section（无 id，含 h1 与 scroll-fade-up 类）",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "关于板块：模板无原生 about，由共享生成区承载（标题+一段企业介绍），pre-place 到 #features 与 #contact 之间。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "通用生成区（data-sitecraft-generated-content=about，adapter 预置 id=about）",
      // 文案已写明"由共享生成区承载"却漏了显式字段 → 门禁按注册表 requiresNative 判违规（假阳性）。
      // 显式声明后与文案一致，L3 不再误报（2026-09-09）。
      nativeFallbackHost: "generated",
    },
    {
      presentationSlot: "features",
      role: "card_grid",
      nativeFallbackHost: "generated",
      presentAs: "核心能力/产品方案：原生 #features 的 9 张圆角 border 卡（图标 svg + 标题 + 正文，lg:grid-cols-3）。建议 6 条正好 2 行 x 3；超出的原生卡隐藏。",
      capacity: { min: 2, default: 6, max: 9 },
      itemShape: "title_body",
      anchor: "id=features 的 section 内 className 含 border/p-8 的 div（h3+p）",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      presentAs: "服务支持：原 5 步流程卡为 SaaS demo 已删除，由共享通用服务卡区承载；建议 3-4 条。",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 6 },
      itemShape: "title_body",
      anchor: "通用生成区（data-sitecraft-generated-content=services，adapter 预置 id=services）",
    },
    {
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "产品中心：无原生产品卡位，由共享产品网格承载（SKU+简介+图，3 列 6 卡）。",
      capacity: { min: 1, default: 6, max: 1000 },
      itemShape: "title_body",
      anchor: "通用生成产品网格（data-sitecraft-generated-products，adapter 预置 id=products）",
    },
    {
      presentationSlot: "contact",
      role: "split_text_media",
      presentAs: "联系板块：原生 #contact 询盘区（左侧标题+说明、右侧表单；adapter 已清英文勾选/条款留白），共享引擎写标题/正文/email/phone/address。",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "id=contact 的 section（含 #contactForm 表单）",
    },
  ],
  recommendation: "eligible",
};
