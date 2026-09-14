import type { Locale } from "../site-model.ts";
import { SLOT_MAX_LENGTH } from "../template-slot-contract.ts";
import type { TemplateManifest, TemplateContentTarget, TemplateSlotBinding, TemplateNonContentSlot, TemplateUiSurface, TemplatePresentationBlock } from "./types.ts";

/**
 * 每模板 manifest 共享构建件：types（经 ./types 再导出）+ 常量 + contentSlots 工厂。
 * 每模板 manifest 数据放 lib/template-manifests/<id>.ts，import 本模块拼装。
 */

export const ALL_UI_SURFACES = ["navigation", "faq", "form", "footer"] as const satisfies readonly TemplateUiSurface[];
export const BOTH_LOCALES = ["zh", "en"] as const satisfies readonly Locale[];

export const NON_CONTENT_SLOTS: readonly TemplateNonContentSlot[] = [
  {
    target: "brand.logo",
    selector: "header img, nav img",
    slotType: "asset",
    coverage: "excluded",
    support: "template-owned",
  },
  {
    target: "hero.image",
    selector: "main section:first-of-type img, [id*='hero'] img",
    slotType: "asset",
    coverage: "excluded",
    support: "template-owned",
  },
  {
    target: "contact.formAction",
    selector: "#contact form, section[id*='contact'] form",
    slotType: "behavior",
    coverage: "excluded",
    // 询盘提交由本站接管（bridge 拦截 → /api/public/<siteKey>/leads），不写模板 demo action。
    // 2026-09-09 前标 unsupported，与实况不符（P3.5 / A8 契约同步）。
    support: "sitecraft-hosted",
  },
] as const;

export function contentSlots(
  demoFingerprints: Partial<Record<TemplateContentTarget, readonly string[]>>,
  selectors: Partial<Record<TemplateContentTarget, string>> = {},
  /**
   * 显式声明「本模板可以没有这些槽」。
   *
   * 为什么需要：`required` 此前**硬编码为 true**，模板无法声明"我这节是非必填"。
   * 后果是「政府站/律所站本来就没有产品目录」这件事无法表达，只能靠运行时隐藏板块
   * （`hiddenSections`）绕开——变成**一个业务事实被塞进一个渲染开关里**。
   *
   * 空数组（缺省）＝保持历史行为（全部必填），因此 22 个基线模板零语义变化。
   */
  options: { optionalTargets?: readonly TemplateContentTarget[] } = {},
): readonly TemplateSlotBinding[] {
  const optional = new Set<string>(options.optionalTargets ?? []);
  const slots = [
    {
      target: "hero.title",
      selector: "main h1, header h1",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["hero.title"],
      demoFingerprints: demoFingerprints["hero.title"] ?? [],
    },
    {
      target: "about.body",
      selector: "#about p, section[id*='about'] p",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["about.body"],
      demoFingerprints: demoFingerprints["about.body"] ?? [],
    },
    {
      target: "features.items",
      selector: "#features article, section[id*='feature'] article",
      contentType: "collection",
      required: true,
      maxLength: SLOT_MAX_LENGTH["features.items"],
      demoFingerprints: demoFingerprints["features.items"] ?? [],
    },
    {
      target: "services.items",
      selector: "#services article, section[id*='service'] article",
      contentType: "collection",
      required: true,
      maxLength: SLOT_MAX_LENGTH["services.items"],
      demoFingerprints: demoFingerprints["services.items"] ?? [],
    },
    {
      target: "products",
      selector: "#products article, #pricing article, section[id*='product'] article",
      contentType: "collection",
      required: true,
      maxLength: SLOT_MAX_LENGTH["products"],
      demoFingerprints: demoFingerprints.products ?? [],
    },
    {
      target: "contact.title",
      selector: "#contact h2, section[id*='contact'] h2",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["contact.title"],
      demoFingerprints: demoFingerprints["contact.title"] ?? [],
    },
    {
      target: "contact.body",
      selector: "#contact p, section[id*='contact'] p",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["contact.body"],
      demoFingerprints: demoFingerprints["contact.body"] ?? [],
    },
    {
      target: "contact.email",
      selector: "#contact a[href^='mailto:'], section[id*='contact'] a[href^='mailto:']",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["contact.email"],
      demoFingerprints: demoFingerprints["contact.email"] ?? [],
    },
    {
      target: "contact.phone",
      selector: "#contact a[href^='tel:'], section[id*='contact'] a[href^='tel:']",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["contact.phone"],
      demoFingerprints: demoFingerprints["contact.phone"] ?? ["待补充"],
    },
    {
      target: "contact.address",
      selector: "#contact address, section[id*='contact'] address",
      contentType: "text",
      required: true,
      maxLength: SLOT_MAX_LENGTH["contact.address"],
      demoFingerprints: demoFingerprints["contact.address"] ?? ["地址待补充", "Address to be completed"],
    },
  ] as const;
  const semanticTypes: Record<TemplateContentTarget, string> = {
    "hero.title": "hero_headline",
    "about.body": "company_story",
    "features.items": "value_propositions",
    "services.items": "service_cards",
    products: "product_catalog",
    "contact.title": "contact_headline",
    "contact.body": "contact_description",
    "contact.email": "contact_email",
    "contact.phone": "contact_phone",
    "contact.address": "contact_address",
  };
  const aliases: Record<TemplateContentTarget, readonly string[]> = {
    "hero.title": ["首屏标题", "hero title", "headline"],
    "about.body": ["公司简介", "about", "company story"],
    "features.items": ["核心优势", "features", "value propositions"],
    "services.items": ["服务项目", "services", "service cards"],
    products: ["产品目录", "products", "catalog"],
    "contact.title": ["联系标题", "contact title"],
    "contact.body": ["联系说明", "contact body", "inquiry"],
    "contact.email": ["邮箱", "email"],
    "contact.phone": ["电话", "phone"],
    "contact.address": ["地址", "address"],
  };
  return slots.map((slot) => ({
    ...slot,
    // `required` 可被模板显式豁免（见参数说明）；未声明时保持 `true`。
    required: optional.has(slot.target) ? false : slot.required,
    selector: selectors[slot.target] ?? slot.selector,
    semanticType: semanticTypes[slot.target],
    aliases: aliases[slot.target],
    locales: BOTH_LOCALES,
    editable: true,
  }));
}

/**
 * 默认原生排版兜底：未手写 presentation 的模板，各集合槽按 card_grid（旧行为）处理。
 * 这是"零回归"关键——不升级的模板继续走通用卡片渲染，与新机制互不影响。
 *
 * 2026-09-09 补 hero：此前默认表**没有 hero 项**，导致 5 个未手写 presentation 的模板
 * （nextjs-landing/kindred/moon/shadcn-landing/tailwind-landing）的 hero 声明缺失，
 * 生成层拿不到首屏形态提示。hero 在任何模板里都存在且形态只有两种，故按
 * `hero_centered` 兜底（最普遍形态），需要精确的可手写覆盖。
 */
export function defaultPresentation(): readonly TemplatePresentationBlock[] {
  return [
    {
      presentationSlot: "hero",
      role: "hero_centered",
      presentAs: "首屏：居中大字标题 + 副文（未手写声明，按居中兜底）",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "首个可见 h1（含 header/main 内）",
    },
    {
      presentationSlot: "about",
      role: "split_text_media",
      presentAs: "关于板块：标题 + 一段企业介绍正文",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "含 about 语义的 section（id/标题定位）",
    },
    {
      presentationSlot: "features",
      role: "card_grid",
      presentAs: "核心优势：卡片网格（未声明原生角色，通用渲染）",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 12 },
      itemShape: "title_body",
      anchor: "含 feature 语义的 section 内 card 类元素",
    },
    {
      presentationSlot: "services",
      role: "card_grid",
      presentAs: "服务：卡片网格（未声明原生角色，通用渲染）",
      nativeFallbackHost: "generated",
      capacity: { min: 2, default: 3, max: 12 },
      itemShape: "title_body",
      anchor: "含 service 语义的 section 内 card 类元素",
    },
    {
      presentationSlot: "products",
      role: "product_grid",
      presentAs: "产品：网格条目（未声明原生角色，通用渲染）",
      capacity: { min: 1, default: 4, max: 1000 },
      itemShape: "title_body",
      anchor: "产品网格区",
    },
    {
      presentationSlot: "contact",
      role: "split_text_media",
      presentAs: "联系板块：标题 + 说明 + 联系方式",
      capacity: { max: 1 },
      itemShape: "title_body",
      anchor: "含 contact 语义的 section（id/表单/mailto 定位）",
    },
  ] as const;
}

export type { TemplateManifest };
