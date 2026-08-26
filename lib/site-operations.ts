import { z } from "zod";
import {
  cloneDraft,
  editableCardSchema,
  locales,
  productSchema,
  sectionKeySchema,
  sectionKeys,
  type EditableCard,
  type Locale,
  type Product,
  type SectionKey,
  type SiteDraft,
} from "./site-document.ts";

export const textTargets = [
  "siteName",
  "companyName",
  "industry",
  "goal",
  "navigation.about",
  "navigation.features",
  "navigation.services",
  "navigation.products",
  "navigation.contact",
  "hero.title",
  "hero.subtitle",
  "hero.cta",
  "about.title",
  "about.body",
  "features.title",
  "features.intro",
  "services.title",
  "services.intro",
  "products.title",
  "products.intro",
  "contact.title",
  "contact.body",
  "contact.email",
  "contact.phone",
  "contact.address",
] as const;
export const textTargetSchema = z.enum(textTargets);
export type TextTarget = z.infer<typeof textTargetSchema>;

const setTextOperationSchema = z.object({
  op: z.literal("set_text"),
  target: textTargetSchema,
  locale: z.enum(locales).optional(),
  value: z.string().min(1).max(1000),
});
const updateCardOperationSchema = z.object({
  op: z.literal("update_card"),
  section: z.enum(["features", "services"]),
  index: z.number().int().min(0).max(11),
  locale: z.enum(locales),
  title: z.string().min(1).max(160).optional(),
  body: z.string().min(1).max(600).optional(),
}).refine((value) => value.title || value.body, "Card update requires title or body");
const addCardOperationSchema = z.object({
  op: z.literal("add_card"),
  section: z.enum(["features", "services"]),
  index: z.number().int().min(0).max(12).optional(),
  item: editableCardSchema,
});
const removeCardOperationSchema = z.object({
  op: z.literal("remove_card"),
  section: z.enum(["features", "services"]),
  itemId: z.string().min(1).max(80),
});
const updateProductOperationSchema = z.object({
  op: z.literal("update_product"),
  sku: z.string().min(1).max(120),
  locale: z.enum(locales).optional(),
  name: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(1000).optional(),
  category: z.string().min(1).max(120).optional(),
}).refine((value) => value.name || value.summary || value.category, "Product update requires at least one field");
const setTemplateOperationSchema = z.object({
  op: z.literal("set_template"),
  templateId: z.string().min(1).max(80),
});
const setSectionVisibilityOperationSchema = z.object({
  op: z.literal("set_section_visibility"),
  section: sectionKeySchema,
  visible: z.boolean(),
});
const reorderSectionsOperationSchema = z.object({
  op: z.literal("reorder_sections"),
  order: z.array(sectionKeySchema).length(sectionKeys.length),
});
const replaceProductsOperationSchema = z.object({
  op: z.literal("replace_products"),
  products: z.array(productSchema).max(1000),
});
const replaceDraftOperationSchema = z.object({
  op: z.literal("replace_draft"),
  draft: z.custom<SiteDraft>(),
});

export const aiOperationSchema = z.discriminatedUnion("op", [
  setTextOperationSchema,
  updateCardOperationSchema,
  addCardOperationSchema,
  removeCardOperationSchema,
  updateProductOperationSchema,
  setTemplateOperationSchema,
  setSectionVisibilityOperationSchema,
  reorderSectionsOperationSchema,
]);

export const siteOperationSchema = z.discriminatedUnion("op", [
  setTextOperationSchema,
  updateCardOperationSchema,
  addCardOperationSchema,
  removeCardOperationSchema,
  updateProductOperationSchema,
  setTemplateOperationSchema,
  setSectionVisibilityOperationSchema,
  reorderSectionsOperationSchema,
  replaceProductsOperationSchema,
  replaceDraftOperationSchema,
]);
export type SiteOperation = z.infer<typeof siteOperationSchema>;
export type AIOperation = z.infer<typeof aiOperationSchema>;

export const aiChangeSchema = z.object({
  summary: z.string().min(1).max(500),
  operations: z.array(aiOperationSchema).max(20),
});
export type AIChange = z.infer<typeof aiChangeSchema>;

export type ApplyResult = {
  draft: SiteDraft;
  inverseOperations: SiteOperation[];
  appliedTargets: string[];
  changed: boolean;
};

const nonLocalizedTargets = new Set<TextTarget>([
  "siteName",
  "companyName",
  "industry",
  "goal",
  "contact.email",
  "contact.phone",
]);

function localizedValue(draft: SiteDraft, target: TextTarget) {
  const values: Record<string, { zh: string; en: string }> = {
    "navigation.about": draft.navigation.about,
    "navigation.features": draft.navigation.features,
    "navigation.services": draft.navigation.services,
    "navigation.products": draft.navigation.products,
    "navigation.contact": draft.navigation.contact,
    "hero.title": draft.content.hero.title,
    "hero.subtitle": draft.content.hero.subtitle,
    "hero.cta": draft.content.hero.cta,
    "about.title": draft.content.about.title,
    "about.body": draft.content.about.body,
    "features.title": draft.content.features.title,
    "features.intro": draft.content.features.intro,
    "services.title": draft.content.services.title,
    "services.intro": draft.content.services.intro,
    "products.title": draft.content.products.title,
    "products.intro": draft.content.products.intro,
    "contact.title": draft.content.contact.title,
    "contact.body": draft.content.contact.body,
    "contact.address": draft.content.contact.address,
  };
  return values[target];
}

function readText(draft: SiteDraft, target: TextTarget, locale: Locale) {
  if (target === "siteName") return draft.siteName;
  if (target === "companyName") return draft.companyName;
  if (target === "industry") return draft.industry;
  if (target === "goal") return draft.goal;
  if (target === "contact.email") return draft.content.contact.email;
  if (target === "contact.phone") return draft.content.contact.phone;
  return localizedValue(draft, target)?.[locale] ?? "";
}

function writeText(draft: SiteDraft, target: TextTarget, locale: Locale, value: string) {
  if (target === "siteName") draft.siteName = value;
  else if (target === "companyName") draft.companyName = value;
  else if (target === "industry") draft.industry = value;
  else if (target === "goal") draft.goal = value;
  else if (target === "contact.email") draft.content.contact.email = value;
  else if (target === "contact.phone") draft.content.contact.phone = value;
  else localizedValue(draft, target)[locale] = value;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function applySiteOperations(
  current: SiteDraft,
  operations: SiteOperation[],
  options: { templateIds: Set<string>; lastChange: string },
): ApplyResult {
  let draft = cloneDraft(current);
  const inverseOperations: SiteOperation[] = [];
  const appliedTargets: string[] = [];

  for (const operation of operations) {
    if (operation.op === "replace_draft") {
      if (same(draft, operation.draft)) continue;
      inverseOperations.unshift({ op: "replace_draft", draft: cloneDraft(draft) });
      draft = cloneDraft(operation.draft);
      appliedTargets.push("draft");
      continue;
    }
    if (operation.op === "set_text") {
      const locale = nonLocalizedTargets.has(operation.target) ? "zh" : (operation.locale ?? "zh");
      const previous = readText(draft, operation.target, locale);
      if (previous === operation.value) continue;
      writeText(draft, operation.target, locale, operation.value);
      inverseOperations.unshift({ ...operation, locale, value: previous });
      appliedTargets.push(`${operation.target}.${locale}`);
      continue;
    }
    if (operation.op === "update_card") {
      const item = draft.content[operation.section].items[operation.index];
      if (!item) throw new Error(`${operation.section} item ${operation.index + 1} does not exist`);
      const inverse: SiteOperation = {
        op: "update_card",
        section: operation.section,
        index: operation.index,
        locale: operation.locale,
        ...(operation.title ? { title: item.title[operation.locale] } : {}),
        ...(operation.body ? { body: item.body[operation.locale] } : {}),
      };
      let changed = false;
      if (operation.title && item.title[operation.locale] !== operation.title) {
        item.title[operation.locale] = operation.title;
        appliedTargets.push(`${operation.section}.items.${operation.index}.title.${operation.locale}`);
        changed = true;
      }
      if (operation.body && item.body[operation.locale] !== operation.body) {
        item.body[operation.locale] = operation.body;
        appliedTargets.push(`${operation.section}.items.${operation.index}.body.${operation.locale}`);
        changed = true;
      }
      if (changed) inverseOperations.unshift(inverse);
      continue;
    }
    if (operation.op === "add_card") {
      const items = draft.content[operation.section].items;
      if (items.some((item) => item.id === operation.item.id)) throw new Error(`Card id ${operation.item.id} already exists`);
      const index = Math.min(operation.index ?? items.length, items.length);
      items.splice(index, 0, structuredClone(operation.item));
      inverseOperations.unshift({ op: "remove_card", section: operation.section, itemId: operation.item.id });
      appliedTargets.push(`${operation.section}.items.${index}`);
      continue;
    }
    if (operation.op === "remove_card") {
      const items = draft.content[operation.section].items;
      const index = items.findIndex((item) => item.id === operation.itemId);
      if (index < 0) throw new Error(`Card ${operation.itemId} does not exist`);
      const [item] = items.splice(index, 1);
      inverseOperations.unshift({ op: "add_card", section: operation.section, index, item });
      appliedTargets.push(`${operation.section}.items.${index}`);
      continue;
    }
    if (operation.op === "update_product") {
      const product = draft.products.find((item) => item.sku === operation.sku);
      if (!product) throw new Error(`Product ${operation.sku} does not exist`);
      const locale = operation.locale ?? "zh";
      const inverse: SiteOperation = {
        op: "update_product",
        sku: operation.sku,
        locale,
        ...(operation.name ? { name: product.name[locale] } : {}),
        ...(operation.summary ? { summary: product.summary[locale] } : {}),
        ...(operation.category ? { category: product.category } : {}),
      };
      let changed = false;
      if (operation.name && product.name[locale] !== operation.name) {
        product.name[locale] = operation.name;
        appliedTargets.push(`products.${operation.sku}.name.${locale}`);
        changed = true;
      }
      if (operation.summary && product.summary[locale] !== operation.summary) {
        product.summary[locale] = operation.summary;
        appliedTargets.push(`products.${operation.sku}.summary.${locale}`);
        changed = true;
      }
      if (operation.category && product.category !== operation.category) {
        product.category = operation.category;
        appliedTargets.push(`products.${operation.sku}.category`);
        changed = true;
      }
      if (changed) inverseOperations.unshift(inverse);
      continue;
    }
    if (operation.op === "set_template") {
      if (!options.templateIds.has(operation.templateId)) throw new Error(`Unknown template ${operation.templateId}`);
      if (draft.templateId === operation.templateId) continue;
      inverseOperations.unshift({ op: "set_template", templateId: draft.templateId });
      draft.templateId = operation.templateId;
      appliedTargets.push("template");
      continue;
    }
    if (operation.op === "set_section_visibility") {
      const wasVisible = !draft.hiddenSections.includes(operation.section);
      if (wasVisible === operation.visible) continue;
      draft.hiddenSections = operation.visible
        ? draft.hiddenSections.filter((item) => item !== operation.section)
        : [...draft.hiddenSections, operation.section];
      inverseOperations.unshift({ ...operation, visible: wasVisible });
      appliedTargets.push(`${operation.section}.visibility`);
      continue;
    }
    if (operation.op === "reorder_sections") {
      if (new Set(operation.order).size !== sectionKeys.length) throw new Error("Section order contains duplicates");
      if (same(draft.sectionOrder, operation.order)) continue;
      inverseOperations.unshift({ op: "reorder_sections", order: [...draft.sectionOrder] });
      draft.sectionOrder = [...operation.order];
      appliedTargets.push("sections.order");
      continue;
    }
    if (operation.op === "replace_products") {
      if (same(draft.products, operation.products)) continue;
      inverseOperations.unshift({ op: "replace_products", products: structuredClone(draft.products) });
      draft.products = structuredClone(operation.products);
      appliedTargets.push("products");
    }
  }

  if (!inverseOperations.length) return { draft: current, inverseOperations: [], appliedTargets: [], changed: false };
  draft.revision = current.revision + 1;
  draft.lastChange = options.lastChange;
  return { draft, inverseOperations, appliedTargets, changed: true };
}

export function validateAIOperations(
  message: string,
  operations: AIOperation[],
  templateIds: Set<string>,
): { operations: SiteOperation[]; rejected: string[] } {
  const rejected: string[] = [];
  // 匹配两类语序：(1) "换/切换/改用...模板"（动词在前）(2) "模板换成/换成模板/模板切换"（名词在前）
  const explicitTemplateSwitch =
    /(?:换|切换|改用|使用|选择|更换).{0,10}(?:模板|版式)/i.test(message) ||
    /(?:模板|版式).{0,10}(?:换|切换|改用|更换)/i.test(message) ||
    /(?:template).{0,20}(?:switch|change|use)/i.test(message) ||
    /(?:switch|change|use).{0,20}(?:template)/i.test(message);

  // 语言约束 conformance：识别用户对语言范围的明确限定
  // 两类：(1) 负面限定 forbid——"别动英文/不要改中文/不动英文" 拒绝该语言 op
  //       (2) 正面限定 allow——"只改中文/仅英文" 只允许该语言 op
  // 仅当出现明确限定词才生效，避免误伤普通指令
  const localeGuard = parseLocaleGuard(message);

  const accepted = operations.filter((operation) => {
    if (operation.op === "set_template") {
      if (!explicitTemplateSwitch) {
        rejected.push("用户没有明确要求更换模板，已拒绝模板切换");
        return false;
      }
      if (!templateIds.has(operation.templateId)) {
        rejected.push(`模板 ${operation.templateId} 不在白名单中`);
        return false;
      }
      return true;
    }
    // 语言越界校验
    const opLocale = "locale" in operation && operation.locale ? operation.locale : null;
    if (opLocale && localeGuard) {
      if (localeGuard.forbid === opLocale) {
        rejected.push(`用户明确不要改动${opLocale === "zh" ? "中文" : "英文"}，已拒绝 ${operation.op} 对${opLocale === "zh" ? "中文" : "英文"}的修改`);
        return false;
      }
      if (localeGuard.allow && localeGuard.allow !== opLocale) {
        rejected.push(`用户限定只修改${localeGuard.allow === "zh" ? "中文" : "英文"}，已拒绝 ${operation.op} 对${opLocale === "zh" ? "中文" : "英文"}的修改`);
        return false;
      }
    }
    return true;
  });
  return { operations: accepted, rejected };
}

type LocaleGuard = { forbid?: "zh" | "en"; allow?: "zh" | "en" };

/**
 * 解析用户指令中的语言范围限定。
 * 返回 LocaleGuard（forbid/allow 可能并存，如"只改中文，别动英文"）。
 * 返回 null 表示未限定。
 * 注意"中英双语/中英文"整体限定不算单语限定。
 */
function parseLocaleGuard(message: string): LocaleGuard | null {
  // 排除"中英"连用（双语不算单语限定）
  if (/中英|中英文|中英双语|中英两种|中英文都/i.test(message)) return null;
  const guard: LocaleGuard = {};
  // 负面限定：别/不要/不用/不动/别动/勿 + 语言词（中文限 2 字符距离，避免"别动英文，把中文"误判）
  const negEn = /(?:别|不要|不用|不动|别动|勿).{0,4}(?:英文|英语)/i.test(message);
  const negZh = /(?:别|不要|不用|不动|别动|勿).{0,2}(?:中文|汉语)/i.test(message);
  if (negEn && !negZh) guard.forbid = "en";
  else if (negZh && !negEn) guard.forbid = "zh";
  // 正面限定：只/仅/只管/就/只改/保持/维持 + 语言词（英文距离放宽到 6，支持 "only change english"）
  const posEn = /(?:只|仅|只管|就|只改|保持|维持).{0,2}(?:英文|英语)|(?:only|just|keep|change).{0,10}english/i.test(message);
  const posZh = /(?:只|仅|只管|就|只改|保持|维持).{0,2}(?:中文|汉语)/i.test(message);
  if (posEn && !posZh) guard.allow = "en";
  else if (posZh && !posEn) guard.allow = "zh";
  return guard.forbid || guard.allow ? guard : null;
}

/**
 * 判定某操作是否属于"破坏性操作"（删除/隐藏/换模板/重排），
 * 这类操作应在提交前让用户确认，避免误删误改。
 */
export function isDestructiveOperation(operation: SiteOperation): boolean {
  switch (operation.op) {
    case "remove_card":
    case "set_template":
    case "reorder_sections":
      return true;
    case "set_section_visibility":
      return operation.visible === false;
    default:
      return false;
  }
}

/** 破坏性操作的简短描述，用于确认提示 */
export function describeDestructive(operation: SiteOperation): string {
  switch (operation.op) {
    case "remove_card":
      return `删除 ${operation.section === "features" ? "核心优势" : "服务"}卡片「${operation.itemId}」`;
    case "set_section_visibility":
      return `隐藏「${operation.section}」区块`;
    case "set_template":
      return `切换模板到 ${operation.templateId}`;
    case "reorder_sections":
      return "调整区块显示顺序";
    default:
      return operation.op;
  }
}

export function describeTarget(target: string) {
  const labels: Record<string, string> = {
    brand: "品牌名称",
    heroTitle: "首屏标题",
    heroSubtitle: "首屏说明",
    primaryCta: "主行动按钮",
    about: "关于我们",
    features: "核心优势",
    services: "服务模块",
    products: "产品与能力",
    contact: "联系模块",
  };
  return labels[target] ?? target;
}

export type { EditableCard, Product, SectionKey };
