import { z } from "zod";
import { draftFieldMaxLength } from "./draft-field-limits.ts";
import { currentOperationName } from "./legacy-op-names.ts";
import { SLOT_MAX_LENGTH } from "./template-slot-contract.ts";
import {
  assetTargetSchema,
  cloneDraft,
  designTokensSchema,
  draftAssetSchema,
  editableItemSchema,
  locales,
  MAX_COLLECTION_ITEMS,
  productSchema,
  sectionKeySchema,
  sectionKeys,
  type EditableItem,
  type Locale,
  type Product,
  type SectionKey,
  type SiteDraft,
} from "./site-document.ts";

/**
 * 静态文本目标白名单。
 *
 * ⚠️ **这里没有 `navigation.*`**（2026-09-11，⑥ 数组化）。
 * 导航项现在是数组，id 由数据决定，**静态枚举装不下**——
 * 写死 `navigation.about` 会在用户加第六项时报"无效目标"。
 *
 * 导航的可写性由 `isValidTextTarget()` 动态判定（见下），
 * 而这个数组只剩两个用途：
 *  1. `ai-provider.ts` 把它拼进提示词，让模型知道**有哪些固定字段**可填；
 *  2. `textTargetSchema` 做静态那部分的 zod 校验。
 *
 * **导航的提示词那一份**在 `ai-provider.ts` 里另外生成（要从草稿取实际 id），
 * 不能靠这个数组——否则模型会照着 `navigation.about` 去填一个 id 叫 `nav-1` 的站。
 */
export const textTargets = [
  "siteName",
  "companyName",
  "industry",
  "goal",
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

/** 动态文本目标：`navigation.<id>`（id 字符集与 `navigationIdSchema` 一致）。 */
const navigationTextTargetSchema = z.string().regex(/^navigation\.[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * `set_text` 的 target 校验：静态白名单 **或** 动态导航项。
 *
 * 用 `z.union` 而不是 `.refine()`：这样 `textTargetSchema` 仍然是**可单独复用**的
 * 窄类型（别人拿它做 `z.enum` 那类事不受影响），而 union 只在这里放宽。
 */
export const setTextTargetSchema = z.union([textTargetSchema, navigationTextTargetSchema]);

/** 本地化目标 → 读取/写入用的定位信息。`null` = 这个 target 不是本地化字段。 */
function navigationIdOf(target: string): string | null {
  return target.startsWith("navigation.") ? target.slice("navigation.".length) : null;
}

/** 这个 target 是不是 `navigation.<某个真实存在的 id>`。 */
export function isValidTextTarget(target: string, draft: SiteDraft): boolean {
  if (textTargetSchema.safeParse(target).success) return true;
  const id = navigationIdOf(target);
  return id !== null && draft.navigation.some((item) => item.id === id);
}

const setTextOperationSchema = z.object({
  op: z.literal("set_text"),
  target: setTextTargetSchema,
  locale: z.enum(locales).optional(),
  value: z.string().min(1).max(1000),
  targetId: z.string().min(1).max(240).optional(),
  expectedValue: z.string().max(1000).optional(),
});
/**
 * 可被 `update_item` 改的板块。
 *
 * `faq` 于 2026-09-11（⑥-4）加入：FAQ 的条目形状**就是** `EditableItem`
 * （`id`/`title`/`body`），复用同一个操作与同一套就地编辑映射最省事，
 * 也不会多出一份要维护的写回逻辑。
 *
 * ⚠️ 加它的时候要同步看三处：本枚举、`lib/inline-edit-mapping.ts` 的 `CARD_SLOT`
 * 与 `REJECTED_PREFIXES`（`faq.` 曾经在里面，加完要拿掉）。
 */
export const cardSections = ["features", "services", "faq"] as const;
const cardSectionSchema = z.enum(cardSections);
export type EditableSection = z.infer<typeof cardSectionSchema>;

const updateCardOperationSchema = z.object({
  op: z.literal("update_item"),
  section: cardSectionSchema,
  index: z.number().int().min(0).max(11).optional().default(0),
  itemId: z.string().min(1).max(80).optional(),
  locale: z.enum(locales),
  title: z.string().min(1).max(160).optional(),
  body: z.string().min(1).max(600).optional(),
  targetId: z.string().min(1).max(240).optional(),
  expectedValue: z.string().max(1000).optional(),
}).refine((value) => value.title || value.body, "Card update requires title or body");
const addCardOperationSchema = z.object({
  op: z.literal("add_item"),
  section: cardSectionSchema,
  /**
   * 插入位置。上限**不能写死**：它是"最多能插到第几个位置"，
   * 而真正的约束是 `MAX_COLLECTION_ITEMS`（`siteDraftSchema` 用它做 `.max()`）。
   *
   * 2026-09-12（阶段 1 冲突 #8，A 项）：此前是字面量 `12`，与 `MAX_COLLECTION_ITEMS`
   * **无 import 关系**——典型的"同值不同源"。两者一旦漂移，这里就会成为越界入口
   * （或反过来把合法的插入挡掉）。改为直接读常量。
   *
   * 注意 `- 1`：满员 12 条时合法插入位是 0..11（插到 12 就是第 13 条）。
   * 但**光靠这里不够**——`index` 是"模型声称插哪"，真正的防线在 `applySiteOperations`
   * 的插入点（B 项），因为多条独立 add_item 累计也会溢出。
   */
  index: z.number().int().min(0).max(MAX_COLLECTION_ITEMS - 1).optional(),
  item: editableItemSchema,
});
const removeCardOperationSchema = z.object({
  op: z.literal("remove_item"),
  section: cardSectionSchema,
  itemId: z.string().min(1).max(80),
});
const updateProductOperationSchema = z.object({
  op: z.literal("update_product"),
  sku: z.string().min(1).max(120),
  locale: z.enum(locales).optional(),
  name: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(1000).optional(),
  category: z.string().min(1).max(120).optional(),
  targetId: z.string().min(1).max(240).optional(),
  expectedValue: z.string().max(1000).optional(),
}).refine((value) => value.name || value.summary || value.category, "Product update requires at least one field");
const setTemplateOperationSchema = z.object({
  op: z.literal("set_template"),
  templateId: z.string().min(1).max(80),
});
/**
 * 客户评价（2026-09-11，⑥-4b）。
 *
 * ## 为什么不能复用 `update_item`
 *
 * 评价的形状是「谁说的 / 他什么身份 / 说了什么」，与 `EditableItem` 的
 * `title`/`body` **语义不同**——硬塞进去，「客户名」会被写进一个叫 `title` 的字段，
 * 而渲染层要用 `<blockquote>` 包正文、`<cite>` 包署名，**节点不同**。
 *
 * ## 字段用 `itemId` 定位，不用下标
 *
 * 与 `remove_item` 同一取舍：评价会增删，下标随时会指到别人身上。
 * 而 `id` 是我们生成时打上去的（`quote-1` 这种），稳定。
 */
const updateTestimonialOperationSchema = z.object({
  op: z.literal("update_testimonial"),
  itemId: z.string().min(1).max(80),
  locale: z.enum(locales),
  quote: z.string().min(1).max(600).optional(),
  author: z.string().min(1).max(160).optional(),
  role: z.string().min(1).max(160).optional(),
  expectedValue: z.string().max(1000).optional(),
}).refine((value) => value.quote || value.author || value.role, "Testimonial update requires at least one field");
/**
 * 客户 Logo 墙的一项（2026-09-11，⑥-4b）。
 *
 * `name` 是**唯一可改的字段**：`logo` 是图片 URL，AI 与就地编辑都拿不到新图，
 * 换图走的是上传通道（与 `set_product_image` 同理）。
 */
const updateLogoOperationSchema = z.object({
  op: z.literal("update_logo"),
  itemId: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  expectedValue: z.string().max(1000).optional(),
});
const setDesignTokensOperationSchema = z.object({
  op: z.literal("set_design_tokens"),
  tokens: designTokensSchema.nullable(),
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
/**
 * 资产替换（P3.2）：把首屏主视觉/品牌 Logo 换成用户上传的实拍图。
 * `asset: null` = 恢复模板原图。
 *
 * **只进 siteOperationSchema，不进 aiOperationSchema**：AI 无法上传图片，
 * 让它在白名单外可以避免模型生成无效操作（生成路径的 validateGenerationOperations 也不含它）。
 */
const setAssetOperationSchema = z.object({
  op: z.literal("set_asset"),
  target: assetTargetSchema,
  asset: draftAssetSchema.nullable(),
});
/**
 * 商品主图（2026-09-10）：把某个 SKU 的主图设成用户上传的实拍图。
 * `image: null` = 清除主图（渲染退回 imageColor 色块）。
 *
 * **与 `set_asset` 同样只进 siteOperationSchema、不进 aiOperationSchema**——
 * AI 无法上传图片，放进白名单只会让模型产出无效操作。
 *
 * 为什么要单独加这个操作：`productSchema.image` 字段一直存在、渲染层也支持，
 * 但**没有任何操作能写它**——`update_product` 只收 name/summary/category。
 * 而 `/api/product-images` 上传接口早就写好了、工作台也已经在用，
 * 结果「产品图」这条主路径在工厂站场景下是断的（评审原话：说服力 80% 来自实拍图）。
 */
const setProductImageOperationSchema = z.object({
  op: z.literal("set_product_image"),
  sku: z.string().min(1).max(120),
  image: z.string().max(2000).nullable(),
});

export const aiOperationSchema = z.discriminatedUnion("op", [
  setTextOperationSchema,
  updateCardOperationSchema,
  addCardOperationSchema,
  removeCardOperationSchema,
  updateProductOperationSchema,
  updateTestimonialOperationSchema,
  updateLogoOperationSchema,
  setTemplateOperationSchema,
  setSectionVisibilityOperationSchema,
  reorderSectionsOperationSchema,
]);

export const siteOperationSchema = z.discriminatedUnion("op", [  setTextOperationSchema,
  updateCardOperationSchema,
  addCardOperationSchema,
  removeCardOperationSchema,
  updateProductOperationSchema,
  updateTestimonialOperationSchema,
  updateLogoOperationSchema,
  setTemplateOperationSchema,
  setDesignTokensOperationSchema,
  setSectionVisibilityOperationSchema,
  reorderSectionsOperationSchema,
  replaceProductsOperationSchema,
  setAssetOperationSchema,
  setProductImageOperationSchema,
  replaceDraftOperationSchema,
]);
export type SiteOperation = z.infer<typeof siteOperationSchema>;
export type AIOperation = z.infer<typeof aiOperationSchema>;

/**
 * op 名的**派生**集合（军规 1：禁手抄）。
 *
 * 从 `siteOperationSchema` 的 discriminatedUnion options 直接读出每个分支的
 * `op` literal 值——schema 增删一个 op，这里自动跟随，不存在"抄漏一个"的可能。
 */
export const KNOWN_OPERATION_NAMES: ReadonlySet<string> = new Set(
  siteOperationSchema.options.map((option) => option.shape.op.value),
);

export const aiChangeSchema = z.object({
  summary: z.string().min(1).max(500),
  operations: z.array(aiOperationSchema).max(20),
});
export type AIChange = z.infer<typeof aiChangeSchema>;

/**
 * **落盘操作的读取归一化**（阶段 4，2026-09-12）。
 *
 * ## 它只干一件事：把旧 op 名换成新名
 *
 * 历史上落盘的 ChangeSet 里写的还是 `update_card` 之类的旧名。改名之后，
 * 那些数据必须**永远读得懂**（用户裁决：读取长期兼容、写入只写新名）。
 *
 * ## 为什么在这里，而不是在读存储的地方
 *
 * 归一化**只准落在两个调用点**（用户裁决第 2 条，禁止第三处）：
 * `lib/site-store.ts` 的 `readRecord()`（文件后端）与 `rowToRecord()`（PG 后端）。
 * 本函数是那两个点共用的**纯函数**——这样做的好处是：
 * **同一份映射，两条读取路径不可能读出不同结果**。
 *
 * ## 刻意不做的事
 *
 * - **不校验、不抛错**：存量形态**比今天的 schema 更宽**（实测：PG 里有 8 条
 *   `update_card` 缺 `locale`）。读到一个不认识的形态时，只能原样放行，
 *   让下游按既有行为处理，**绝不能在这里抛错**——那会让整个站点读不出来。
 * - **不补字段**：补默认值是"解释数据"，属于另一个决策（见 glossary T-6）。
 *   本函数只做**名字映射**，语义边界要窄、要看得懂。
 * - **不改写原对象**：返回新对象，调用方拿到的历史条目与落盘内容一致。
 */
export function normalizePersistedOperations(operations: unknown): SiteOperation[] {
  if (!Array.isArray(operations)) return [];
  return operations.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry as SiteOperation;
    const named = entry as Record<string, unknown>;
    const current = currentOperationName(named.op);
    // 名字没变就不复制对象——绝大多数条目走这条路，避免无谓的整批深拷贝。
    if (current === named.op) return entry as SiteOperation;
    return { ...named, op: current } as SiteOperation;
  });
}

export type ApplyResult = {
  draft: SiteDraft;
  inverseOperations: SiteOperation[];
  appliedTargets: string[];
  changed: boolean;
};

export class OperationPreconditionError extends Error {
  readonly code = "precondition_failed" as const;

  constructor(target: string) {
    super(`操作前置条件不满足：${target} 当前内容已变化，草稿未修改`);
    this.name = "OperationPreconditionError";
  }
}

function assertExpectedValue(expectedValue: string | undefined, actualValue: string, target: string) {
  if (expectedValue !== undefined && expectedValue !== actualValue) throw new OperationPreconditionError(target);
}

/**
 * 非本地化 target（写 `locale: "en"` 会被静默忽略，所以强制归一成 `zh`）。
 *
 * 类型是 `Set<string>` 而不是 `Set<TextTarget>`：`set_text` 的 target
 * 现在包含动态的 `navigation.<id>`（⑥），窄类型装不下。
 * 这几个成员本身没变——导航项**是**本地化的，不该进来。
 */
const nonLocalizedTargets = new Set<string>([
  "siteName",
  "companyName",
  "industry",
  "goal",
  "contact.email",
  "contact.phone",
]);

/**
 * 取某个本地化 target 对应的 `{ zh, en }` 引用（**返回的是草稿里的那个对象**，
 * 所以 `writeText` 改它就是改草稿）。
 *
 * ## 为什么导航要单独一条
 *
 * 导航项是数组，`navigation.<id>` 里的 id 是数据决定的，**不是静态键**——
 * 放进下面那张常量表里根本表达不了。所以先按 id 在数组里找。
 *
 * **返回 `undefined` 而不是抛异常**：调用方（`readText` / `writeText`）对
 * "target 不存在"的既有处理就是空串/放弃。抛异常会让一个模型幻觉出来的
 * target 把整批操作搞崩——而现在它只是这一条不生效。
 */
function localizedValue(draft: SiteDraft, target: string) {
  const navId = navigationIdOf(target);
  if (navId) return draft.navigation.find((item) => item.id === navId)?.label;

  const values: Record<string, { zh: string; en: string } | undefined> = {
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

function readText(draft: SiteDraft, target: string, locale: Locale) {
  if (target === "siteName") return draft.siteName;
  if (target === "companyName") return draft.companyName;
  if (target === "industry") return draft.industry;
  if (target === "goal") return draft.goal;
  if (target === "contact.email") return draft.content.contact.email;
  if (target === "contact.phone") return draft.content.contact.phone;
  return localizedValue(draft, target)?.[locale] ?? "";
}

function writeText(draft: SiteDraft, target: string, locale: Locale, value: string) {
  if (target === "siteName") draft.siteName = value;
  else if (target === "companyName") draft.companyName = value;
  else if (target === "industry") draft.industry = value;
  else if (target === "goal") draft.goal = value;
  else if (target === "contact.email") draft.content.contact.email = value;
  else if (target === "contact.phone") draft.content.contact.phone = value;
  else {
    /**
     * ⚠️ **这里曾经会因为一个不存在的 target 直接把整批操作打崩**。
     *
     * 旧代码是 `localizedValue(draft, target)[locale] = value`——`localizedValue`
     * 用一张常量表取值，取不到返回 `undefined`，然后对它取下标就是
     * `TypeError: Cannot set properties of undefined`。
     *
     * 导航数组化之后这个风险变大了：模型完全可能输出一个草稿里不存在的
     * `navigation.foo`（它只看得见提示词里列的字段，看不见实际有哪些 id）。
     * 那不该是一次**整站级的失败**，只该是这一条不生效。
     *
     * 改成"找不到就跳过"：这条操作石沉大海，但用户的其它改动照常保存。
     */
    const holder = localizedValue(draft, target);
    if (holder) holder[locale] = value;
  }
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 取某个可编辑板块的条目数组，**顺带保证 faq 节存在**。
 *
 * ## 为什么不能直接 `draft.content[section].items`
 *
 * `features` / `services` 在 `siteDraftSchema` 里是**必填**，直接索引没事；
 * 但 `content.faq` 是**可选**的（图里没有 FAQ 的站不该被迫空着这一节，
 * 见 `site-document.ts` 的说明）。对 `undefined` 取 `.items` 会直接抛
 * `TypeError: Cannot read properties of undefined`，而那是**整批操作失败**——
 * 用户改一条 FAQ 却把同一批里的其它改动一起丢了。
 *
 * 所以进入这里就补齐一个空壳。**这是有意的副作用**：能走到这个函数的调用点
 * 都意味着"这条操作就是要写 faq"，补一个空壳正是它的前提。
 */
/**
 * 取某个可编辑板块的条目数组，**顺带保证 faq 节存在**。
 *
 * ## 为什么不能直接 `draft.content[section].items`
 *
 * `features` / `services` 在 `siteDraftSchema` 里是**必填**，直接索引没事；
 * 但 `content.faq` 是**可选**的（图里没有 FAQ 的站不该被迫空着这一节，
 * 见 `site-document.ts` 的说明）。对 `undefined` 取 `.items` 会直接抛
 * `TypeError: Cannot read properties of undefined`，而那是**整批操作失败**——
 * 用户改一条 FAQ 却把同一批里的其它改动一起丢了。
 *
 * 所以进入这里就补齐一个空壳。**这是有意的副作用**：能走到这个函数的调用点
 * 都意味着"这条操作就是要写 faq"，补一个空壳正是它的前提。
 *
 * ⚠️ **必须把新壳赋回 `draft.content`**，不能只返回一个临时对象：
 * 后面的 `items.splice(...)` / `item.title[locale] = ...` 改的是这个数组，
 * 赋回去才真的落到草稿上。（写第一版时漏了这一步，等于"改了但没保存"。）
 */
function editableItems(draft: SiteDraft, section: EditableSection): EditableItem[] {
  const existing = draft.content[section];
  if (existing) return existing.items;
  const created = { title: { zh: "", en: "" }, intro: { zh: "", en: "" }, items: [] as EditableItem[] };
  draft.content[section] = created;
  return created.items;
}

export function applySiteOperations(
  current: SiteDraft,
  operations: SiteOperation[],
  options: { templateIds: Set<string>; lastChange: string },
): ApplyResult {
  /**
   * === B3 宽修 · 入口兜底断言（Q1=A 的"断言兜底"那一半）===
   *
   * 职责边界（**刻意只拦一种**，2026-09-13 实测校正）：
   *
   * - 拦**未知 op**：它没有任何分支处理，会静默穿过整条 `if` 长链——
   *   既不报错也不生效，"AI 说改了但没改"且查不出来。这是唯一必须在这里拦的形态。
   * - **不拦**"已知 op 但字段越界"（如满员后 `index=12`）：那些**已经**由各分支的
   *   显式 `throw` 兜着（容量、越界、重复 id），而且**抛错在这里反而更糟**——
   *   整批 op 一起回滚，正是 B3 明文禁止的"一条坏操作炸掉整批"。
   *   实测教训：`tests/site-operations.test.ts` 的「冲突 #8」用例给的正是
   *   `index=12`＋已存在 id 的形态，旧路径抛的是**容量**中文文案；若让断言
   *   先按 schema 报"字段越界"，既改变既有错误语义，又把该用例的验收点挪走。
   *
   * ⚠️ 历史重放（undo/redo）不走这条断言：`moveHistory` 重放的是当时合法的历史 op
   * （含归一化后的旧名 update_card→update_item），宽修只挡新提交（Q4 裁决）。
   */
  for (const operation of operations) {
    if (!KNOWN_OPERATION_NAMES.has(operation.op)) {
      throw new Error(
        `未知操作 ${String(operation.op)}（B3 宽修兜底，见 glossary T-6）：无法识别，已拒绝整批以避免静默无事发生`,
      );
    }
  }
  let draft = cloneDraft(current);
  const inverseOperations: SiteOperation[] = [];
  const appliedTargets: string[] = [];
  /** T-6 窄修：同一批里只报告一次坏 locale，避免一条坏历史刷屏。 */
  let reportedInvalidLocale = false;

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
      assertExpectedValue(operation.expectedValue, previous, `${operation.target}.${locale}`);
      if (previous === operation.value) continue;
      writeText(draft, operation.target, locale, operation.value);
      inverseOperations.unshift({ ...operation, locale, value: previous });
      appliedTargets.push(`${operation.target}.${locale}`);
      continue;
    }
    if (operation.op === "update_item") {
      /**
       * === 窄修降级为防御性断言（B3 宽修，2026-09-13 用户裁决 Q3）===
       *
       * 历史：这里曾是"跳过并报告一次"的**主防线**——JS 会把 `undefined` 转成
       * 字符串 `"undefined"` 当键，于是草稿的 `title`/`body` 里会多出一个
       * `undefined` 键、`changed = true`，**数据被改坏却不报错**。
       *
       * 宽修后**新提交**的坏 locale 已经在入口（路由 filter / 生成出口闸门）被拒，
       * 走不到这里；能走到这里的只剩**历史重放**（undo/redo 重放旧 op，
       * 用户裁决 Q4：重放不过宽修）。
       *
       * 所以本分支**保留但降级**：
       *  - 语义不变（仍是跳过 + 报告一次，不抛错——重放路径一条坏历史不该毁掉整次撤销）；
       *  - 但它的定位从"主防线"变成"**断言**"：**宽修后不应可达**；
       *    若新提交走到了这里，说明有路径漏接了宽修门 → **那是一次回归**。
       *
       * 为什么不直接删：删掉会让历史重放失去最后一道网（上面那类"undefined 键"
       * 的坏数据是真实存在的形态——PG 里 8 条缺 locale 的 update_card 归一化后
       * 正好落进这条路径）。
       */
      if (!locales.includes(operation.locale)) {
        if (!reportedInvalidLocale) {
          reportedInvalidLocale = true;
          console.warn(
            "[site-operations] 跳过一条缺少合法 locale 的 update_item（历史重放形态）。"
            + "B3 宽修后新提交不应可达此处——可达即回归，见 glossary T-6。",
          );
        }
        continue;
      }
      const items = editableItems(draft, operation.section);
      const resolvedIndex = operation.itemId
        ? items.findIndex((candidate) => candidate.id === operation.itemId)
        : operation.index;
      const item = items[resolvedIndex];
      if (!item) throw new Error(`${operation.section} item ${operation.index + 1} does not exist`);
      const expectedTarget = operation.title !== undefined
        ? `${operation.section}.items.${resolvedIndex}.title.${operation.locale}`
        : `${operation.section}.items.${resolvedIndex}.body.${operation.locale}`;
      const expectedActual = operation.title !== undefined ? item.title[operation.locale] : item.body[operation.locale];
      assertExpectedValue(operation.expectedValue, expectedActual, expectedTarget);
      const inverse: SiteOperation = {
        op: "update_item",
        section: operation.section,
        index: resolvedIndex,
        itemId: item.id,
        locale: operation.locale,
        ...(operation.title ? { title: item.title[operation.locale] } : {}),
        ...(operation.body ? { body: item.body[operation.locale] } : {}),
      };
      let changed = false;
      if (operation.title && item.title[operation.locale] !== operation.title) {
        item.title[operation.locale] = operation.title;
        appliedTargets.push(`${operation.section}.items.${resolvedIndex}.title.${operation.locale}`);
        changed = true;
      }
      if (operation.body && item.body[operation.locale] !== operation.body) {
        item.body[operation.locale] = operation.body;
        appliedTargets.push(`${operation.section}.items.${resolvedIndex}.body.${operation.locale}`);
        changed = true;
      }
      if (changed) inverseOperations.unshift(inverse);
      continue;
    }
    if (operation.op === "add_item") {
      const items = editableItems(draft, operation.section);
      if (items.some((item) => item.id === operation.item.id)) throw new Error(`Card id ${operation.item.id} already exists`);
      /**
       * === B 项：插入点容量前置校验（阶段 1 冲突 #8 的**主防线**）===
       *
       * 为什么必须在**这里**拦，而不是只靠 `addCardOperationSchema.index.max()`（A 项）：
       *
       * A 项约束的是"模型声称插到第几个位置"，**单条**操作合法；但同一个批次里
       * 多条 `add_item` **各自都没超 index 上限、加起来照样越界**。实测复现：
       * 满员 12 条时插 `index=12`，下面的 `Math.min(..., items.length)` 把它夹到尾部，
       * 于是得到**第 13 条** → `siteDraftSchema` 的 `.max(MAX_COLLECTION_ITEMS)` 解析失败
       * → 下次读取走 `normalizeDraft` 的 destructive 兜底，**整站回退成演示文案**。
       *
       * 拒绝方式与同文件其它越界一致：**抛带中文说明的 Error**（调用方按单条捕获/丢弃）。
       * 错误文案要说人话并带上真实数字——`features item 4 does not exist` 那种
       * 英文原样外泄正是 2026-09-10 修过的同类缺陷。
       */
      if (items.length >= MAX_COLLECTION_ITEMS) {
        throw new Error(
          `${operation.section} 已达模板可容纳的条数上限（最多 ${MAX_COLLECTION_ITEMS} 条），无法再新增；请先删除一条或改为修改现有条目。`,
        );
      }
      const index = Math.min(operation.index ?? items.length, items.length);
      items.splice(index, 0, structuredClone(operation.item));
      inverseOperations.unshift({ op: "remove_item", section: operation.section, itemId: operation.item.id });
      appliedTargets.push(`${operation.section}.items.${index}`);
      continue;
    }
    if (operation.op === "remove_item") {
      const items = editableItems(draft, operation.section);
      const index = items.findIndex((item) => item.id === operation.itemId);
      if (index < 0) throw new Error(`Card ${operation.itemId} does not exist`);
      const [item] = items.splice(index, 1);
      inverseOperations.unshift({ op: "add_item", section: operation.section, index, item });
      appliedTargets.push(`${operation.section}.items.${index}`);
      continue;
    }
    if (operation.op === "update_product") {
      const product = draft.products.find((item) => item.sku === operation.sku);
      if (!product) throw new Error(`Product ${operation.sku} does not exist`);
      const locale = operation.locale ?? "zh";
      const expectedTarget = operation.name !== undefined
        ? `products.${operation.sku}.name.${locale}`
        : operation.summary !== undefined
          ? `products.${operation.sku}.summary.${locale}`
          : `products.${operation.sku}.category`;
      const expectedActual = operation.name !== undefined
        ? product.name[locale]
        : operation.summary !== undefined
          ? product.summary[locale]
          : product.category;
      assertExpectedValue(operation.expectedValue, expectedActual, expectedTarget);
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
    if (operation.op === "update_testimonial") {
      const items = draft.content.testimonials?.items;
      const item = items?.find((candidate) => candidate.id === operation.itemId);
      // `content.testimonials` 与 `faq` 一样是**可选**的（图里没有评价区的站不该被迫空着）。
      // 找不到就抛——与 `update_product` 同一口径：**改一个不存在的条目是调用方的错**，
      // 不该静默吞掉（那会让"AI 说改了但没改"变成一个查不出的问题）。
      if (!item) throw new Error(`Testimonial ${operation.itemId} does not exist`);
      const locale = operation.locale;
      assertExpectedValue(
        operation.expectedValue,
        operation.quote !== undefined ? item.quote[locale] : operation.author !== undefined ? item.author[locale] : item.role[locale],
        `testimonials.items.${operation.itemId}.${operation.quote !== undefined ? "quote" : operation.author !== undefined ? "author" : "role"}.${locale}`,
      );
      const inverse: SiteOperation = {
        op: "update_testimonial",
        itemId: item.id,
        locale,
        ...(operation.quote ? { quote: item.quote[locale] } : {}),
        ...(operation.author ? { author: item.author[locale] } : {}),
        ...(operation.role ? { role: item.role[locale] } : {}),
      };
      let changed = false;
      for (const field of ["quote", "author", "role"] as const) {
        const next = operation[field];
        if (next && item[field][locale] !== next) {
          item[field][locale] = next;
          appliedTargets.push(`testimonials.items.${item.id}.${field}.${locale}`);
          changed = true;
        }
      }
      if (changed) inverseOperations.unshift(inverse);
      continue;
    }
    if (operation.op === "update_logo") {
      const item = draft.logos.find((candidate) => candidate.id === operation.itemId);
      if (!item) throw new Error(`Logo ${operation.itemId} does not exist`);
      assertExpectedValue(operation.expectedValue, item.name, `logos.${operation.itemId}.name`);
      if (item.name === operation.name) continue;
      inverseOperations.unshift({ op: "update_logo", itemId: item.id, name: item.name });
      item.name = operation.name;
      appliedTargets.push(`logos.${item.id}.name`);
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
    if (operation.op === "set_design_tokens") {
      if (same(draft.designTokens, operation.tokens)) continue;
      inverseOperations.unshift({ op: "set_design_tokens", tokens: structuredClone(draft.designTokens) });
      draft.designTokens = structuredClone(operation.tokens);
      appliedTargets.push("design.tokens");
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
      continue;
    }
    // 资产替换（P3.2）：必须放在 replace_products **之后**——它前面各分支都有显式 continue，
    // 不会落入 replace_draft 的兜底逆操作（该兜底只覆盖 replace_draft 自身，见上方 234 行）。
    if (operation.op === "set_asset") {
      const previous = draft.assets[operation.target] ? structuredClone(draft.assets[operation.target]) : null;
      if (same(previous ?? null, operation.asset)) continue;
      inverseOperations.unshift({ op: "set_asset", target: operation.target, asset: previous ?? null });
      if (operation.asset) draft.assets[operation.target] = structuredClone(operation.asset);
      else delete draft.assets[operation.target];
      appliedTargets.push(operation.target);
    }

    if (operation.op === "set_product_image") {
      const product = draft.products.find((item) => item.sku === operation.sku);
      if (!product) throw new Error(`Product ${operation.sku} does not exist`);
      const previous = product.image ?? null;
      if (previous === operation.image) continue;
      // 可撤销：记录上一张图（null = 原本没有图）
      inverseOperations.unshift({ op: "set_product_image", sku: operation.sku, image: previous });
      if (operation.image) product.image = operation.image;
      else delete product.image;
      appliedTargets.push(`products.${operation.sku}.image`);
    }
  }

  if (!inverseOperations.length) return { draft: current, inverseOperations: [], appliedTargets: [], changed: false };
  draft.revision = current.revision + 1;
  draft.lastChange = options.lastChange;
  return { draft, inverseOperations, appliedTargets, changed: true };
}

/**
 * === B3 宽修 · 入口操作形状全面校验（T-6 完整解，2026-09-13）===
 *
 * ## 语义（与 `validateGenerationOperations` 对齐）
 *
 * **拒单条 + 可读中文原因，其余保留**——禁止新增"一条坏操作炸掉整批"的路径。
 *
 * ## 校验项全部派生，零字面量（军规 1 / B2 门禁）
 *
 * 一条 `siteOperationSchema.safeParse` 就是权威派生：
 *  - op 枚举（discriminatedUnion 的 15 个 literal）；
 *  - `section ∈ cardSections`（各 schema 的 `z.enum(cardSections)`）；
 *  - `locale ∈ locales`（`z.enum(locales)`）；
 *  - `order` 必须是 `sectionKeys` 的一个排列；
 *  - `target`：静态 `textTargets` **或**动态 `navigation.<id>`（`setTextTargetSchema`
 *    本身就是这个并集的权威定义）。
 *
 * ## 为什么合法集要写成 `textTargets` ∪「当前模板 manifest targets」（Q2 裁决）
 *
 * 用户 2026-09-13 裁决：合法文本 target = `textTargets` ∪ 当前模板 manifest 的
 * targets，双 import。全量误伤检查（`scripts/b3-target-audit.ts`，22 模板 220 个
 * target 实例）结论：**误伤面 0**——154 个实例全在 `textTargets` 里，其余 66 个是
 * `features.items` / `services.items` / `products` 三个**槽位级（collection）**
 * target（各 22 个模板共享），它们走 `add_item`/`remove_item`/`update_item`
 * 通道，本就不是 `set_text` 的目标。
 *
 * ⚠️ **`update_item` 的 locale 在 schema 里是必填**（`z.enum(locales)`，无 `.optional()`），
 * 而入口旧窄修把它当"可能缺"处理——历史数据里确实存在缺 locale 的 `update_card`。
 * 本函数对缺 locale 的 `update_item` **放行**（不拒），让旧窄修继续兜住它们：
 * 宽修管的是**新提交**，历史重放是旧窄修的领地（用户裁决 Q4：重放不过宽修）。
 */
export function validateOperationShapes(operations: unknown[]): {
  valid: SiteOperation[];
  rejected: string[];
} {
  const valid: SiteOperation[] = [];
  const rejected: string[] = [];
  for (const entry of operations) {
    const parsed = siteOperationSchema.safeParse(entry);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    const named = (entry ?? {}) as Record<string, unknown>;
    const op = typeof named.op === "string" ? named.op : "(缺 op)";
    // ⚠️ 例外：历史形态（缺 locale 的 update_item）放行给旧窄修——
    // 它是"跳过并报告一次"的领地，不是"拒绝"的领地。
    if (named.op === "update_item" && named.locale === undefined) {
      valid.push(entry as SiteOperation);
      continue;
    }
    const first = parsed.error.issues[0];
    const where = first?.path?.join(".") || "(根)";
    /**
     * zod 的 issue **不带"收到的坏值"**（实测：`invalid_value` 只有 values/path/message），
     * 所以按 path 回原输入里取——"原因里要点出是哪个值坏了"是 B3 的可读性要求。
     */
    let received: unknown = entry;
    for (const key of first?.path ?? []) {
      if (received === null || typeof received !== "object") { received = undefined; break; }
      received = (received as Record<string, unknown>)[key as never];
    }
    const shown = typeof received === "string" || typeof received === "number"
      ? JSON.stringify(received)
      : received === undefined ? "(缺失)" : "(非标量)";
    rejected.push(`操作 ${op} 被拒绝（字段 ${where}=${shown} 不受支持，其余操作已保留）`);
  }
  return { valid, rejected };
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
    // 文案长度确定性校验（Q2，Codex 反馈）：标题/副标题超限则拒绝，不依赖 system prompt
    const copyLengthRejection = checkCopyLength(operation);
    if (copyLengthRejection) {
      rejected.push(copyLengthRejection);
      return false;
    }
    return true;
  });
  return { operations: accepted, rejected };
}

/**
 * 生成场景专用校验（一句话建站初稿）。
 * 与 validateAIOperations 不同：生成是主动建站，set_template 只查白名单（不要求"明确换模板"）；
 * 不做 locale guard（生成 prompt 明确 zh+en）；保留白名单 + 文案长度校验。
 */
/**
 * 生成路径允许的操作，按场景区分。
 * 修复（2026-09-08）：此前是黑名单（只拒 set_template 越界 + 文案超长），
 * add_item/remove_item/reorder_sections 都能通过——与 automation.md 声明的
 * "操作白名单校验"不符，AI 可借此无限加卡撑爆模板排版。
 */
export type GenerationOpScope =
  /** 整站初稿：只填内容，不改结构（增删卡属用户显式请求） */
  | "draft"
  /** 局部重生成（mode=text）：只改文本 */
  | "regenerate"
  /** 局部重生成（mode=all）：允许增删卡片，但受模板原生容量约束 */
  | "regenerate-structure";

const ALLOWED_OPS_BY_SCOPE: Readonly<Record<GenerationOpScope, ReadonlySet<SiteOperation["op"]>>> = Object.freeze({
  draft: new Set<SiteOperation["op"]>([
    "set_text", "update_item", "update_product", "set_section_visibility", "set_template", "set_design_tokens",
  ]),
  regenerate: new Set<SiteOperation["op"]>([
    "set_text", "update_item", "update_product", "set_design_tokens",
  ]),
  "regenerate-structure": new Set<SiteOperation["op"]>([
    "set_text", "update_item", "add_item", "remove_item", "update_product", "set_design_tokens",
  ]),
});

export type GenerationCapacityContext = {
  /** 模板各板块的原生容量（来自 TemplateCapabilitySummary.presentation） */
  presentation: readonly { presentationSlot: string; capacityMax: number }[];
  /** 基准草稿的现有条数（容量校验以此为起点做净增投影） */
  baseCounts: Record<"features" | "services", number>;
};

export function validateGenerationOperations(
  operations: SiteOperation[],
  templateIds: Set<string>,
  capacity?: GenerationCapacityContext,
  scope: GenerationOpScope = "draft",
): { operations: SiteOperation[]; rejected: string[] } {
  const rejected: string[] = [];
  const allowedOps = ALLOWED_OPS_BY_SCOPE[scope];
  // 先算各集合板块的净增投影：add/remove 配对时不应误判超容
  //
  // ⚠️ **只投影模板有原生容量的板块**（`features` / `services`）。
  // `faq` 是 ⑥-4 加进来的，模板 manifest 里**没有** `faq.items` 这一项——
  // 它的容量由 schema 的 `MAX_COLLECTION_ITEMS` 兜，不走这里。
  // 不过滤的话 `projected[operation.section] += 1` 会对一个不存在的键做加法，
  // 结果是 `NaN`，而 `NaN > n` 恒为 `false` —— **门槛会静默失效**。
  const capacitySections = ["features", "services"] as const;
  const isCapacitySection = (section: EditableSection): section is (typeof capacitySections)[number] =>
    (capacitySections as readonly string[]).includes(section);
  const projected: Record<"features" | "services", number> = capacity
    ? { ...capacity.baseCounts }
    : { features: 0, services: 0 };
  if (capacity) {
    for (const operation of operations) {
      if (operation.op !== "add_item" && operation.op !== "remove_item") continue;
      if (!isCapacitySection(operation.section)) continue;
      if (operation.op === "add_item") projected[operation.section] += 1;
      else projected[operation.section] = Math.max(0, projected[operation.section] - 1);
    }
  }
  const overCapacity = new Set<string>();
  if (capacity) {
    for (const section of capacitySections) {
      /**
       * ⚠️ 查的是**裸段名** `"features"`，不是 `"features.items"`。
       *
       * 2026-09-12 修（阶段 1 冲突 #1，P0）：此前这里写的是 `${section}.items`，
       * 而生产传进来的 `presentation[].slot` 是 `getTemplatePresentation()` 的
       * `p.slot`——**裸段名**（`site-generator.ts:405`/`:891`，实例见
       * `template-manifests/forge.ts:25-67` 的 `slot: "features"`）。
       * 于是 `find` 永远返回 undefined → `overCapacity` 恒为空 →
       * **`add_item` 越界从不被拦**。
       *
       * 单测此前喂的是 `"features.items"`，**测的是生产永远不会传的形态**，
       * 所以它一直是绿的。这正是 2026-09-10「AI 按容量提示写、越界到应用层炸掉整批」
       * 能发生的原因：当时加的这道防线**根本没接上**。
       *
       * 注意职责边界：本集合**只管 `add_item`**（见下方 `overCapacity.has`）。
       * `update_item` 的越界由另一条路径拦（比对草稿真实条数），那条一直是好的——
       * 别在这里顺手改坏它。
       */
      const block = capacity.presentation.find((entry) => entry.presentationSlot === section);
      if (block && projected[section] > block.capacityMax) overCapacity.add(section);
    }
  }
  const accepted = operations.filter((operation) => {
    if (!allowedOps.has(operation.op)) {
      rejected.push(`当前场景不允许操作 ${operation.op}`);
      return false;
    }
    if (operation.op === "set_template") {
      if (!templateIds.has(operation.templateId)) {
        rejected.push(`模板 ${operation.templateId} 不在白名单中`);
        return false;
      }
      return true;
    }
    if (operation.op === "add_item" && overCapacity.has(operation.section)) {
      // 键同样是裸段名（与上方 overCapacity 的构建口径一致）。
      const block = capacity?.presentation.find((entry) => entry.presentationSlot === operation.section);
      const projectedCount = isCapacitySection(operation.section) ? projected[operation.section] : 0;
      rejected.push(`${operation.section} 超出模板原生容量（至多 ${block?.capacityMax ?? "?"} 条，当前将达 ${projectedCount} 条）`);
      return false;
    }
    /**
     * update_item 越界防护（2026-09-10 真机修复）。
     *
     * 真机证据：一句话建站真实流程里，AI 输出 `update_item index 4`，
     * 而草稿 features 只有 3 条 → applySiteOperations 抛
     * `features item 4 does not exist` → **整份 commitOperations 回滚，
     * 用户 66 秒生成全部丢失，界面显示英文技术错误**。
     *
     * 根因是 prompt 与草稿不一致：给 AI 看的容量是模板值
     * （forge features `capacity.default/max = 6/12`），而草稿里只有 3 条，
     * AI 按容量提示写到第 4、5 条。此前这里只校验 add_item，update_item 完全不拦。
     *
     * 为什么在这里拦而不是让 applySiteOperations 兜底：应用层遇到越界只能抛错，
     * 而抛错会让**整批**操作回滚——一条坏操作不该摧毁其余几十条有效内容。
     * 在这里拒绝单条、保留其余，是"部分成功优于全部失败"。
     *
     * 无 capacity 上下文时不做此判定（向后兼容，交由应用层兜底）。
     */
    if (operation.op === "update_item" && capacity && !operation.itemId && isCapacitySection(operation.section)) {
      const limit = capacity.baseCounts[operation.section];
      if (typeof limit === "number" && operation.index >= limit) {
        rejected.push(
          `${operation.section} 第 ${operation.index + 1} 条不存在（当前仅 ${limit} 条），已跳过该条修改`,
        );
        return false;
      }
    }
    // 文案长度确定性校验（Q2）：标题/副标题超限则拒绝
    const copyLengthRejection = checkCopyLength(operation);
    if (copyLengthRejection) {
      rejected.push(copyLengthRejection);
      return false;
    }
    return true;
  });
  // 分而治之改造后：同一槽位可能被多个板块组重复写入（如 about 组与 contact 组都写了 contact.title）。
  // 按"最后写入生效"去重，避免重复操作浪费提交并保证确定性。
  const deduped = dedupeByTarget(accepted);
  /**
   * === B3 宽修 · 出口形状闸门 ===
   *
   * 上面的语义校验（scope / 容量 / 越界 / 长度）**不跑 `siteOperationSchema`**，
   * 而生成路径的 ops 直接来自模型输出——所以这里补一道形状过滤，
   * 与语义拒绝同一个出口（拒单条 + `rejected[]` 可读中文），
   * **不新增"一条坏操作炸整批"的路径**。
   */
  const shaped = validateOperationShapes(deduped);
  return { operations: shaped.valid, rejected: [...rejected, ...shaped.rejected] };
}

/** 同一目标（target + locale，或 section + index/itemId）只保留最后一次写入 */
function dedupeByTarget(operations: SiteOperation[]): SiteOperation[] {
  const lastIndex = new Map<string, number>();
  operations.forEach((operation, index) => {
    const key = operationIdentity(operation);
    if (key) lastIndex.set(key, index);
  });
  return operations.filter((operation, index) => {
    const key = operationIdentity(operation);
    return !key || lastIndex.get(key) === index;
  });
}

/**
 * 同批操作的**冲突指纹**——`op` 级(**单元**)，不带字段。
 *
 * ## 这是全仓库唯一一处拼 `item:` 前缀的地方（2026-09-12 收口）
 *
 * 在此之前有两处手拼，而且**已经漂了**：
 *  - `lib/chat-task-executor.ts` 的 `operationEffects` 用 `item.id` / `operation.index`
 *  - 本文件的 `operationIdentity` 用 `itemId ?? index`
 * 漂了不会让任何测试变红，只会在**真实冲突上漏判 → 静默丢一条操作**。
 * 现在两边都从这里取，**不可能再漂**。
 *
 * ## 单元级 vs 字段级
 *
 * - 本函数（单元级）：判断"两条操作是否改**同一条目**"——`dedupeByTarget` 用它。
 * - `operationConflictEffects`（字段级）：判断"是否改**同一条目的同一字段**"——
 *   `mergeChatTaskResults` 的冲突判定用它。
 *
 * 两者共用同一个单元前缀，字段级只是后面多接一段后缀，所以**前缀绝不会各写各的**。
 *
 * ## `add_item` 为什么用 `item.id` 而不是下标
 *
 * 从前 chat 侧用 `item.id`、去重侧用 `index ?? "end"`。**统一取更严的那个**：
 * 用下标的话，两条在**同一下标**插入**不同条目**的操作会被误判成同一条而丢一条
 * ——那正是 ⑥-4b 在 `update_testimonial` 上记过的教训（内容静默少改一处）。
 * 用 id 则只在**真是同一个条目**时才合并。
 */
export function operationConflictIdentity(operation: SiteOperation): string | null {
  if (operation.op === "set_text") return `text:${operation.target}:${operation.locale ?? "zh"}`;
  if (operation.op === "update_item") return `item:${operation.section}:${operation.itemId ?? operation.index}:${operation.locale ?? "zh"}`;
  if (operation.op === "add_item") return `item:${operation.section}:${operation.item.id}`;
  if (operation.op === "remove_item") return `item:${operation.section}:${operation.itemId}`;
  if (operation.op === "update_product") return `product:${operation.sku}:${operation.locale ?? "zh"}`;
  // 评价与 Logo（⑥-4b）按 itemId 定位——它们会增删，下标随时会指到别人身上
  if (operation.op === "update_testimonial") return `testimonial:${operation.itemId}:${operation.locale}`;
  if (operation.op === "update_logo") return `logo:${operation.itemId}`;
  if (operation.op === "set_asset") return `asset:${operation.target}`;
  if (operation.op === "set_product_image") return `product:${operation.sku}:image`;
  if (operation.op === "set_section_visibility") return `visibility:${operation.section}`;
  if (operation.op === "reorder_sections") return "section-order";
  if (operation.op === "set_template") return "template";
  if (operation.op === "set_design_tokens") return "design";
  if (operation.op === "replace_products") return "products";
  if (operation.op === "replace_draft") return "draft";
  return null;
}

/**
 * 单元级指纹；没有指纹的返回 `null`（`dedupeByTarget` 据此原样保留）。
 *
 * **保留这个名字**是有意的：它是去重路径用的既有契约名，
 * 实现直接委托给 `operationConflictIdentity`，语义上就是同一个东西。
 */
function operationIdentity(operation: SiteOperation): string | null {
  return operationConflictIdentity(operation);
}

/** 可以冲突的字段（多字段 op 才需要）；不在此表的 op 是整单元一件。 */
const CONFLICT_FIELDS: Partial<Record<SiteOperation["op"], readonly string[]>> = {
  update_item: ["title", "body"],
  update_product: ["name", "summary", "category"],
  update_testimonial: ["quote", "author", "role"],
  update_logo: ["name"],
};

/** 单元级操作用于冲突比较的"那个值"（整单元一件的 op）。 */
function unitConflictValue(operation: SiteOperation): unknown {
  switch (operation.op) {
    case "set_text": return operation.value;
    case "add_item": return operation.item;
    case "remove_item": return null;
    case "set_template": return operation.templateId;
    case "set_design_tokens": return operation.tokens;
    case "set_section_visibility": return operation.visible;
    case "reorder_sections": return operation.order;
    case "replace_products": return operation.products;
    case "set_asset": return operation.asset;
    case "set_product_image": return operation.image;
    case "replace_draft": return operation.draft;
    default: return undefined;
  }
}

function fieldConflictValue(operation: SiteOperation, field: string): unknown {
  return (operation as unknown as Record<string, unknown>)[field];
}

/**
 * **同批操作的冲突/去重指纹（字段级）**——`mergeChatTaskResults` 用它判断
 * "多个任务是否改到了同一条目的同一字段而给出不同值"。
 *
 * 由 [`operationConflictIdentity`](#) 加字段后缀派生，所以**前缀只有一处定义**。
 */
export function operationConflictEffects(operation: SiteOperation): Array<{ key: string; value: unknown }> {
  const unit = operationConflictIdentity(operation);
  if (!unit) return [];
  const fields = CONFLICT_FIELDS[operation.op];
  if (!fields) return [{ key: unit, value: unitConflictValue(operation) }];
  return fields
    .filter((field) => fieldConflictValue(operation, field) !== undefined)
    .map((field) => ({ key: `${unit}:${field}`, value: fieldConflictValue(operation, field) }));
}

/** 字段级指纹的键列表（供测试做同源断言）。 */
export function operationConflictKeys(operation: SiteOperation): string[] {
  return operationConflictEffects(operation).map((effect) => effect.key);
}

/**
 * 文案长度：**有契约就按契约，没契约才用启发值**。
 *
 * ## 2026-09-12 改（真机实测）
 *
 * `about.body` 原先跟 `hero.subtitle` 共用「中文 40 字 / 英文 25 词」这个**启发值**，
 * 并在写入前被**硬拒**。真机实测（客户旅程第三轮）：模型连续 4 次写 `about.body`，
 * 长度 **58 / 60 / 64 / 94 字**，**全部超出 40 而被拒**——「公司简介」这个字段
 * **永远写不进去**，草稿里于是留着 Forge 的演示文案
 * （"我们把工程、制造与交付能力放在同一个清晰体系中。"）。而 `default-draft-leak`
 * 只在 e2e 里查、**不在发布门上**，所以那句演示文案被当成正式内容**发布给了访客**。
 *
 * 根子不在"40 太小"，而在**拿启发值盖住了契约**：
 *  - `about.body` 的契约容量是 **800**（`SLOT_MAX_LENGTH`）；
 *  - 生成提示词**早就把这个数字给模型了**（`slotConstraints=${JSON.stringify(...)}`）；
 *  - 唯独写入校验器不认它。
 *
 * ## 唯一事实源是 `SLOT_MAX_LENGTH`
 *
 * 不是模板 manifest——`hero.cta` 这类目标**有契约容量但没有 manifest 槽位**，
 * 只查 manifest 会漏掉它。`SLOT_MAX_LENGTH` 是两者的共同上游
 * （manifest 的 `maxLength` 正是从它取值，见 `template-manifests/shared.ts`），
 * 所以读它既是"契约优先"，也天然覆盖所有声明过容量的目标。
 *
 * 只有**连 `SLOT_MAX_LENGTH` 都没声明**的目标（如 `hero.subtitle`）才落到下面的版式启发值。
 */
function copyLengthLimit(target: string, locale: string): number | null {
  const declared = SLOT_MAX_LENGTH[target as keyof typeof SLOT_MAX_LENGTH];
  if (typeof declared === "number") return declared;
  if (target === "hero.title" || target === "about.title" || target === "hero.cta") {
    return locale === "en" ? 10 : 15;
  }
  if (target === "hero.subtitle") {
    return locale === "en" ? 25 : 40;
  }
  return null;
}

function measureCopy(text: string, locale: string): number {
  return locale === "en" ? text.trim().split(/\s+/).filter(Boolean).length : [...text].length;
}

function exceedsLimit(text: string, locale: string, limit: number): boolean {
  return measureCopy(text, locale) > limit;
}

/**
 * 文案长度的**唯一判定源**（2026-09-11 提取）。
 *
 * 此前这段「取 limit → 比较 → 拼拒绝文案」在 `validateAIOperations`
 * 与 `validateGenerationOperations` 里**逐字重复了两遍**；就地编辑（`PUT /draft`）
 * 则**完全没有这道校验**，于是"存得进去、发不出去"。
 * 提取成一处后，三条入口共用同一个口径。
 *
 * 覆盖**三类**上限（判定顺序即优先级，先命中先返回）：
 *  1. **字段硬上限**（`DRAFT_FIELD_MAX_LENGTH`）：`siteName`/`companyName`/`industry`/
 *     `goal`/`contact.email`/`contact.phone`。它们在 `siteDraftSchema` 里有硬上限，
 *     写入放行而读取失败会让 `normalizeDraft` **把整站回退成演示文案**（P-0 静默数据丢失）。
 *     放在最前是因为 `contact.email` 这类字段**同时**有槽位容量，而硬上限更严、后果更重。
 *  2. **模板契约容量**（`contractMaxLength`，读 manifest 的 `maxLength`）：
 *     **唯一事实源**——生成提示词早就把同一个数字给模型了，校验器必须读同一处。
 *  3. **版式启发值**（`copyLengthLimit`）：只对 manifest 里**没有槽位**的目标生效
 *     （`hero.title`/`hero.cta`/`hero.subtitle`）。有契约的目标**不该**走到这里——
 *     2026-09-12 的 `about.body` 事故就是启发值盖住契约造成的（详见 `copyLengthLimit` 注释）。
 *
 * 返回 null 表示通过；否则返回给人看的拒绝原因。
 */
export function checkCopyLength(operation: SiteOperation): string | null {
  if (operation.op !== "set_text" || !operation.value) return null;

  // 第 1 类：字段硬上限（非本地化字段，按字符数判）
  //
  // 放在最前面：`contact.email` 这类字段**同时**有槽位与硬上限，而硬上限才是权威——
  // 它约束的是 `siteDraftSchema`，超了会让 `normalizeDraft` 把整站回退成演示文案，
  // 比"渲染时截断"严重得多。先判它，才不会用较松的模板容量放过一次数据丢失。
  const hardLimit = draftFieldMaxLength(operation.target);
  if (hardLimit !== null) {
    const actual = [...operation.value].length;
    if (actual <= hardLimit) return null;
    return `「${operation.target}」超出上限：应为 ${hardLimit} 字以内（当前 ${actual}）。超出会导致草稿保存失败并使整站内容回退，请精简后重试。`;
  }

  // 第 2 类：契约容量（`SLOT_MAX_LENGTH`）与版式启发值（见 `copyLengthLimit` 注释）
  //
  // 容量按**字符数**判，与 `evaluateDraftQuality` 的 `exceedsCopyLimit`
  // （`Array.from(trimmed).length > slot.maxLength`）保持一致——
  // 两边判的是同一个字段，口径不同就会变成"存得进去、发不出去"。
  //
  // ⚠️ 不能拿 `measureCopy`（中文数字数、英文数**词**）来比容量：那是**可读性**口径，
  // 拿它比 800 会让英文槽永远判不超（60 词 vs 800），等于没设防。
  const locale = operation.locale ?? "zh";
  const limit = copyLengthLimit(operation.target, locale);
  if (!limit) return null;

  const declared = SLOT_MAX_LENGTH[operation.target as keyof typeof SLOT_MAX_LENGTH];
  if (typeof declared === "number") {
    const actual = Array.from(operation.value.trim()).length;
    if (actual <= declared) return null;
    return `文案超出模板容量：${operation.target} 应为 ${declared} 字以内（当前 ${actual}）。请精简后重试。`;
  }

  // 第 3 类：版式启发值——只对连容量都没声明的目标生效（如 `hero.subtitle`）
  if (!exceedsLimit(operation.value, locale, limit)) return null;
  return `文案超出长度限制：${operation.target} ${locale} 应为 ${limit}${locale === "en" ? " 词" : " 字"}以内（当前 ${measureCopy(operation.value, locale)}）`;
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
    case "remove_item":
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
    case "remove_item":
      return `删除${operation.section === "features" ? "核心优势" : "服务"}卡片「${operation.itemId}」`;
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

/**
 * 把**槽位 id**（质检器返回的形态，如 `hero.title` / `about.body` / `products.FM-1.summary.zh`）
 * 翻译成用户看得懂的中文位置描述。
 *
 * 2026-09-10：工作台此前直接把 `hero.title` 这类 id 列给用户看，既看不懂也点不了。
 * 用户答复「不点（生成页的细节面板），我直接进工作台看」——因此相关工作台提示必须**可定位**：
 * 这里是可读化的那一半，另一半是把 label 映射回可点的槽位（见 `slotForQualityIssue`）。
 */
const SLOT_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  subtitle: "副标题",
  body: "正文",
  cta: "按钮文案",
  intro: "导语",
  summary: "简介",
  category: "分类",
  name: "名称",
  email: "邮箱",
  phone: "电话",
  address: "地址",
  formAction: "表单",
};
const SLOT_SECTION_LABELS: Record<string, string> = {
  hero: "首屏",
  about: "关于我们",
  features: "核心优势",
  services: "服务模块",
  products: "产品与能力",
  contact: "联系模块",
  brand: "品牌",
  navigation: "导航",
};

export function describeSlot(slot: string): string {
  const parts = slot.split(".");
  const section = SLOT_SECTION_LABELS[parts[0]] ?? parts[0];
  // products.<sku>.<field>.<locale>：带 SKU 的商品字段
  if (parts[0] === "products" && parts.length >= 3) {
    const field = SLOT_FIELD_LABELS[parts[2]] ?? parts[2];
    return `产品「${parts[1]}」的${field}`;
  }
  const fieldPart = parts.slice(1).find((part) => SLOT_FIELD_LABELS[part]) ?? parts[1];
  const field = fieldPart ? SLOT_FIELD_LABELS[fieldPart] ?? fieldPart : "";
  return field ? `${section}的${field}` : section;
}

/**
 * 质检问题槽位 → 预览里可点选的目标。
 *
 * 取值必须落在 `OpenSourceTemplateFrame` 能识别的槽位前缀里，否则点选无反应。
 * 返回 null 表示该问题无法在预览中定位（调用方只显示可读描述）。
 */
export function slotForQualityIssue(slot: string): string | null {
  const [section, ...rest] = slot.split(".");
  const FIELD_TO_TARGET: Record<string, string> = {
    title: section === "hero" ? "hero.title" : `${section}.title`,
    subtitle: `${section}.subtitle`,
    body: `${section}.body`,
    cta: "hero.cta",
    intro: `${section}.intro`,
  };
  const field = rest[0];
  if (!field) return null;
  return FIELD_TO_TARGET[field] ?? null;
}

export type { EditableItem, Product, SectionKey };
