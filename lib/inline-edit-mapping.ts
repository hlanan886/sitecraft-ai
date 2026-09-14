/**
 * 就地编辑反向映射（P3.1，2026-09-09）。
 *
 * 输入：iframe 里被点选节点的 `data-sitecraft-slot` + 用户新输入的文本 + 编辑前的原值。
 * 输出：一条标准 `SiteOperation`（或明确的拒绝原因）。
 *
 * **为什么是纯函数**：映射规则是本功能最容易出错的部分（22 模板 × 多种 slot 形态），
 * 抽成纯函数才能离线单测。红队实测 22 模板共 42 种 slot：可映射 31 / 有意拒绝 11 / 不可映射 0。
 *
 * **slot 形态**（实测自 `scripts/probe-slot-mapping.mjs`）：
 *   - `hero.title.zh`                  → set_text，locale 取后缀
 *   - `about.body`                     → set_text，无后缀（生成兜底区写入时不带 locale），按 uiLocale
 *   - `features.items.<id|index>.title.zh` → update_item
 *   - `products.<sku>.name.zh`         → update_product（sku 可能含 `.`，需贪婪匹配）
 *   - `companyName.zh` / `contact.email.zh` → 非本地化 target，locale 必须归一到 zh
 *
 * **有意拒绝**（给用户人话原因，不静默）：`footer.*` / `form.*` / `faq.*` / 无 slot 节点 /
 * 含 `img|svg|picture|video|iframe` 的节点（替换文本会销毁图标）。
 */
import type { SiteDraft } from "./site-document.ts";
import { cardSections } from "./site-operations.ts";
import type { Locale } from "./site-model.ts";
import type { SiteOperation } from "./site-operations.ts";

/** 非本地化 target：写 `locale: "en"` 会被 site-operations.ts:242 静默忽略，故这里主动归一 */
const NON_LOCALIZED_TARGETS = new Set(["siteName", "companyName", "industry", "goal", "contact.email", "contact.phone"]);

/**
 * 可作为 set_text 目标的本地化字段前缀。
 *
 * ⚠️ **不含 `navigation.*`**（2026-09-11，⑥）：导航项的 id 由**数据**决定，
 * 静态集合装不下。导航走下面的 `NAV_SLOT` 动态匹配，
 * 校验由 `site-operations.ts` 的 `isValidTextTarget()` 用真实草稿判定。
 */
const SET_TEXT_TARGETS = new Set([
  "hero.title", "hero.subtitle", "hero.cta",
  "about.title", "about.body",
  "features.title", "features.intro",
  "services.title", "services.intro",
  "products.title", "products.intro",
  "contact.title", "contact.body", "contact.address",
]);

const CARD_SLOT = new RegExp(`^(${cardSections.join("|")})\\.items\\.([^.]+)\\.(title|body)(?:\\.(zh|en))?$`);
/** 产品字段：`products.<sku>.<name|summary>.<locale>`（sku 可含 `.`，用贪婪匹配） */
const PRODUCT_SLOT = /^products\.(.+)\.(name|summary)(?:\.(zh|en))?$/;
/** 通用文本字段：`<target>.<locale>` 或 `<target>`（无后缀） */
const TEXT_SLOT = /^([a-z][a-zA-Z.]*?)(?:\.(zh|en))?$/;
/** Logo 墙：`logos.<index>.name`（中段是数字，`TEXT_SLOT` 的字符类吃不下） */
const LOGO_SLOT = /^logos\.(\d+)\.name$/;
/**
 * 客户评价（2026-09-11，⑥-4b）：`testimonials.items.<id>.<quote|author|role>[.<locale>]`。
 *
 * 槽位是**下标**（拼装器按 `items.0.quote` 打），但操作要用 `itemId` 定位——
 * 转换在下面的分支里做（拿下标去草稿里查 id）。
 */
const TESTIMONIAL_SLOT = /^testimonials\.items\.([^.]+)\.(quote|author|role)(?:\.(zh|en))?$/;
/**
 * 导航项：`navigation.<id>[.<locale>]`（2026-09-11，⑥）。
 *
 * ## 为什么是两段而不是 `navigation.<id>.label.<locale>`
 *
 * 一开始写成了三段（多一个 `label` 字段名），但那是**自创的形态**：
 * 全项目的约定是 `<target>.<locale>`（`hero.title.zh` 里 `hero.title` 是 target），
 * 而且**22 个适配器已经在 emit `navigation.<key>.zh` 了**。
 * 三段式会让适配器与拼装器各说一种语言——正是文件头说的"两套命名并存"。
 *
 * 所以沿用既有形态：target 是 `navigation.<id>`，locale 是可选的尾段。
 *
 * ⚠️ **不能交给上面的 `TEXT_SLOT` 兜**：它的字符类是 `[a-zA-Z.]`，
 * **吃不下数字和短横线**，而导航 id 允许 `[a-z0-9-]`。
 * `navigation.about-us` 在 `TEXT_SLOT` 下整条不匹配（那反而还好），
 * 但 `navigation.about2.zh` 会被错切成 target=`navigation.about`、locale 丢失……
 * 总之**自己一条**最稳。
 */
const NAV_SLOT = /^navigation\.([a-z0-9][a-z0-9-]{0,39})(?:\.(zh|en))?$/;

/** 有意拒绝的 slot 前缀（模板 UI 文案，不属于 draft 内容）。 */

/**
 * 有意拒绝的 slot 前缀（模板 UI 文案，不属于 draft 内容）。
 *
 * ⚠️ **`faq.` 在 2026-09-11（⑥-4）从这张表里去掉了**，来龙去脉记在这：
 *
 * ④ 时我**试过**去掉它又放回来了，理由是"放行也没用——`update_item` 的 section
 * 枚举只认 features/services，faq 走不进去，用户点得动、改完报错，报错还来自
 * 一个与就地编辑不相干的接口"。那个判断当时是对的。
 *
 * ⑥-4 把 `update_item` 的 section 扩成了 `["features","services","faq"]`，
 * 前提消失了，所以**现在可以放行**：`faq.items.N.title` 会走
 * `CARD_SLOT` → `update_item`，与 features 完全同一条路。
 */
const REJECTED_PREFIXES = ["footer.", "form.", "brand.", "hero.image"];

/** 可映射的槽位前缀（供 bridge 序列化注入，避免两端规则漂移） */
export const INLINE_EDITABLE_PREFIXES: readonly string[] = [
  ...SET_TEXT_TARGETS,
  "siteName", "companyName", "industry", "goal",
  "contact.email", "contact.phone",
];

/**
 * 服务端判定"这个槽位可编辑吗"时用的**动态槽位正则源**。
 *
 * ## 为什么要导出正则源而不是让各处自己写
 *
 * 预览路由会往 iframe 里注入 bridge 脚本，它需要判断"点这个节点该不该进编辑态"。
 * 那段脚本**跑在浏览器里**，import 不了本模块——只能把规则**序列化**进去。
 *
 * 导航项（⑥）的槽位是 `navigation.<id>.label`，**中段带变量**，
 * 静态的前缀数组（`INLINE_EDITABLE_PREFIXES`）表达不了。所以额外导出这条正则源。
 *
 * ⚠️ **两处必须一致**：这里改了，注入桥里的那段也要改
 * （`lib/template-preview-bridge.ts`，B4 后由它直接引用本常量，所以改这一处就够）。
 * 而**真正拦得住的是服务端保存时的那次 `slotToDraftOperation`**——
 * bridge 里的判断只是"要不要弹输入框"，用户能在 devtools 里绕过它，
 * 绕过了也只会拿到一条可读的拒绝原因。
 */
export const NAV_SLOT_PATTERN = "^navigation\\.[a-z0-9][a-z0-9-]{0,39}(?:\\.(?:zh|en))?$";

/** 有意拒绝的前缀（供 bridge 判断是否提示「不支持直接编辑」） */
export const INLINE_EDIT_REJECTED_PREFIXES: readonly string[] = REJECTED_PREFIXES;

/** 各字段的长度上限（与 site-operations.ts 的 schema 对齐，提前拦截以给出可读提示） */
const VALUE_LIMITS = {
  text: 1000,
  cardTitle: 160,
  cardBody: 600,
  productName: 200,
  productSummary: 1000,
} as const;

export type InlineEditRejection =
  | "not_editable"
  | "unsupported_slot"
  | "stale_target"
  | "ambiguous"
  | "invalid_value"
  | "contains_media";

export type InlineEditResolution =
  | { ok: true; operation: SiteOperation; label: string }
  | { ok: false; code: InlineEditRejection; message: string };

export type InlineEditInput = {
  slot: string;
  value: string;
  /** 编辑前的值（用于 expectedValue 乐观并发保护） */
  originalValue: string;
  draft: SiteDraft;
  /** UI 当前语言，用于无 locale 后缀的 slot */
  uiLocale: Locale;
};

function reject(code: InlineEditRejection, message: string): InlineEditResolution {
  return { ok: false, code, message };
}

/** 值归一化：与 bridge 的 normalizeText 口径一致，避免每次重注入判定「不同」而重写 */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 把点选槽位映射为一条草稿操作。
 *
 * 失败时返回**可读原因**（用户看得到），而不是静默失败——这是 P3.6 划定的 HIGH CRAFT 要求。
 */
export function slotToDraftOperation(input: InlineEditInput): InlineEditResolution {
  const slot = String(input.slot || "").trim();
  const value = normalize(input.value);
  const originalValue = normalize(input.originalValue);

  if (!slot) {
    return reject("not_editable", "这个位置不支持直接编辑，已切换为 AI 修改");
  }
  if (!value) {
    return reject("invalid_value", "内容不能为空");
  }
  if (value === originalValue) {
    // 无变化：不生成操作（调用方据此直接退出编辑态）
    return reject("invalid_value", "内容没有变化");
  }
  if (REJECTED_PREFIXES.some((prefix) => slot.startsWith(prefix))) {
    return reject("unsupported_slot", "该位置是模板自带的固定文案，暂不支持直接编辑");
  }

  // ---- 卡片：features/services.items.<key>.<title|body>[.locale] ----
  const cardMatch = CARD_SLOT.exec(slot);
  if (cardMatch) {
    const [, section, key, field, localeSuffix] = cardMatch;
    const items = input.draft.content[section as "features" | "services"].items;
    const byId = items.filter((item) => item.id === key);
    // 先判歧义再判越界：重复 id 时 byId.length !== 1，若先判越界会被误报成 stale_target
    if (!/^\d+$/.test(key) && byId.length !== 1) {
      return reject(
        byId.length === 0 ? "stale_target" : "ambiguous",
        byId.length === 0 ? "该条目已变化，请重新点击后再编辑" : "该条目无法唯一定位，请重新点击后再编辑",
      );
    }
    const index = /^\d+$/.test(key) ? Number(key) : items.indexOf(byId[0]);
    if (index < 0 || index >= items.length) {
      return reject("stale_target", "该条目已变化，请重新点击后再编辑");
    }
    const locale = (localeSuffix as Locale | undefined) ?? input.uiLocale;
    const item = items[index];
    const previous = (field === "title" ? item.title : item.body)?.[locale] ?? "";
    const limit = field === "title" ? VALUE_LIMITS.cardTitle : VALUE_LIMITS.cardBody;
    if (value.length > limit) {
      return reject("invalid_value", `内容过长（上限 ${limit} 字），请精简后再保存`);
    }
    const operation: SiteOperation = {
      op: "update_item",
      section: section as "features" | "services",
      index,
      itemId: item.id,
      locale,
      ...(field === "title" ? { title: value } : { body: value }),
      ...(previous ? { expectedValue: previous } : {}),
    } as SiteOperation;
    return { ok: true, operation, label: `${section === "features" ? "核心优势" : "服务"}第 ${index + 1} 条${field === "title" ? "标题" : "说明"}` };
  }

  // ---- 产品：products.<sku>.<name|summary>[.locale] ----
  const productMatch = PRODUCT_SLOT.exec(slot);
  if (productMatch) {
    const [, sku, field, localeSuffix] = productMatch;
    const matched = (input.draft.products ?? []).filter((product) => product.sku === sku);
    if (matched.length !== 1) {
      return reject("stale_target", "该产品已变化，请重新点击后再编辑");
    }
    const locale = (localeSuffix as Locale | undefined) ?? input.uiLocale;
    const product = matched[0];
    const previous = (field === "name" ? product.name : product.summary)?.[locale] ?? "";
    const limit = field === "name" ? VALUE_LIMITS.productName : VALUE_LIMITS.productSummary;
    if (value.length > limit) {
      return reject("invalid_value", `内容过长（上限 ${limit} 字），请精简后再保存`);
    }
    const operation: SiteOperation = {
      op: "update_product",
      sku,
      locale,
      ...(field === "name" ? { name: value } : { summary: value }),
      ...(previous ? { expectedValue: previous } : {}),
    } as SiteOperation;
    return { ok: true, operation, label: `产品「${sku}」${field === "name" ? "名称" : "简介"}` };
  }

  // ---- 客户评价：testimonials.items.<key>.<field>[.locale]（⑥-4b）----
  const testimonialMatch = TESTIMONIAL_SLOT.exec(slot);
  if (testimonialMatch) {
    const [, key, field, localeSuffix] = testimonialMatch;
    const items = input.draft.content.testimonials?.items ?? [];
    // 与卡片同一条定位规则：先按 id 查，查不到再当下标——
    // 并**先判歧义再判越界**（重复 id 时若先判越界会被误报成 stale_target）
    const byId = items.filter((item) => item.id === key);
    if (!/^\d+$/.test(key) && byId.length !== 1) {
      return reject(
        byId.length === 0 ? "stale_target" : "ambiguous",
        byId.length === 0 ? "该条目已变化，请重新点击后再编辑" : "该条目无法唯一定位，请重新点击后再编辑",
      );
    }
    const index = /^\d+$/.test(key) ? Number(key) : items.indexOf(byId[0]);
    if (index < 0 || index >= items.length) return reject("stale_target", "该条目已变化，请重新点击后再编辑");
    const item = items[index];
    const locale = (localeSuffix as Locale | undefined) ?? input.uiLocale;
    const previous = item[field as "quote" | "author" | "role"][locale] ?? "";
    if (value.length > VALUE_LIMITS.cardBody) {
      return reject("invalid_value", `内容过长（上限 ${VALUE_LIMITS.cardBody} 字），请精简后再保存`);
    }
    const operation: SiteOperation = {
      op: "update_testimonial",
      itemId: item.id,
      locale,
      [field]: value,
      ...(previous ? { expectedValue: previous } : {}),
    } as SiteOperation;
    return { ok: true, operation, label: `客户评价第 ${index + 1} 条的${{ quote: "内容", author: "署名", role: "身份" }[field]}` };
  }

  // ---- 客户 Logo：logos.<index>.name（⑥-4b）----
  const logoMatch = LOGO_SLOT.exec(slot);
  if (logoMatch) {
    const index = Number(logoMatch[1]);
    const item = input.draft.logos[index];
    if (!item) return reject("stale_target", "该条目已变化，请重新点击后再编辑");
    if (value.length > VALUE_LIMITS.cardTitle) {
      return reject("invalid_value", `内容过长（上限 ${VALUE_LIMITS.cardTitle} 字），请精简后再保存`);
    }
    const operation: SiteOperation = {
      op: "update_logo",
      itemId: item.id,
      name: value,
      ...(item.name ? { expectedValue: item.name } : {}),
    } as SiteOperation;
    return { ok: true, operation, label: `客户「${item.name}」` };
  }

  // ---- 导航项：navigation.<id>.label[.locale]（⑥）----
  const navMatch = NAV_SLOT.exec(slot);
  if (navMatch) {
    const [, id, localeSuffix] = navMatch;
    const item = input.draft.navigation.find((nav) => nav.id === id);
    // 找不到 = 导航已经变了（用户删了这项，或换了模板）——与卡片同一条提示口径
    if (!item) return reject("stale_target", "该导航项已变化，请重新点击后再编辑");
    const locale = (localeSuffix as Locale | undefined) ?? input.uiLocale;
    const previous = item.label[locale] ?? "";
    if (value.length > VALUE_LIMITS.text) {
      return reject("invalid_value", `内容过长（上限 ${VALUE_LIMITS.text} 字），请精简后再保存`);
    }
    const operation: SiteOperation = {
      op: "set_text",
      target: `navigation.${id}`,
      locale,
      value,
      ...(previous ? { expectedValue: previous } : {}),
    } as SiteOperation;
    return { ok: true, operation, label: `导航「${previous || id}」` };
  }

  // ---- 通用文本：<target>[.locale] ----
  const textMatch = TEXT_SLOT.exec(slot);
  if (textMatch) {
    const target = textMatch[1];
    const localeSuffix = textMatch[2] as Locale | undefined;
    const isNonLocalized = NON_LOCALIZED_TARGETS.has(target);
    if (SET_TEXT_TARGETS.has(target) || isNonLocalized || target === "siteName" || target === "companyName" || target === "industry" || target === "goal") {
      if (value.length > VALUE_LIMITS.text) {
        return reject("invalid_value", `内容过长（上限 ${VALUE_LIMITS.text} 字），请精简后再保存`);
      }
      const locale = isNonLocalized ? "zh" : (localeSuffix ?? input.uiLocale);
      const previous = readDraftText(input.draft, target, locale);
      const operation: SiteOperation = {
        op: "set_text",
        target: target as never,
        locale,
        value,
        ...(previous ? { expectedValue: previous } : {}),
      } as SiteOperation;
      return { ok: true, operation, label: targetLabel(target) };
    }
    if (/^(features|services)\.items\./.test(slot) || /^products\./.test(slot)) {
      return reject("stale_target", "该条目已变化，请重新点击后再编辑");
    }
    return reject("unsupported_slot", "这个位置不支持直接编辑，已切换为 AI 修改");
  }

  return reject("unsupported_slot", "这个位置不支持直接编辑，已切换为 AI 修改");
}

/** 读取草稿里某 target 的当前值（用于 expectedValue） */
function readDraftText(draft: SiteDraft, target: string, locale: Locale): string {
  if (target === "siteName") return draft.siteName;
  if (target === "companyName") return draft.companyName;
  if (target === "industry") return draft.industry;
  if (target === "goal") return draft.goal;
  if (target === "contact.email") return draft.content.contact.email;
  if (target === "contact.phone") return draft.content.contact.phone;
  const navId = navTargetId(target);
  if (navId) return draft.navigation.find((item) => item.id === navId)?.label[locale] ?? "";
  return readContentText(draft, target, locale);
}

/** `navigation.<id>` → `<id>`；不是导航目标时返回 null。 */
function navTargetId(target: string): string | null {
  return target.startsWith("navigation.") ? target.slice("navigation.".length) : null;
}

/**
 * 从 `content.<section>.<field>` 取文本。
 *
 * ⚠️ **只认 `SET_TEXT_TARGETS` 里列过的 target**（2026-09-11，⑥-4 修正）。
 *
 * 原来的写法是"把 target 按点切开，逐层索引草稿"——看着通用，其实**不成立**：
 * `faq.title` 会被切成 `content["faq"]["title"]`，拿到的是 `{zh,en}` 对象，
 * 于是 `String(对象)` 得到 `"[object Object]"` 当成期望值。
 *
 * 它之所以一直没暴露，是因为从前 `faq.` 被 `REJECTED_PREFIXES` 提前挡掉了，
 * 根本走不到这儿。⑥-4 放行 `faq.items.*` 之后这条路径才被走到——
 * **一个被别处的拒绝规则掩盖着的 bug**。
 *
 * 现在改成显式白名单查表：不在表里就返回空串（= 不做乐观并发校验），
 * 而不是返回一个看似有值实则错的值。
 */
function readContentText(draft: SiteDraft, target: string, locale: Locale): string {
  const content = draft.content as unknown as Record<string, Record<string, unknown> | undefined>;
  const [group, field] = target.split(".");
  if (!SET_TEXT_TARGETS.has(target) || !group || !field) return "";
  const section = content[group];
  const raw = section?.[field];
  if (raw && typeof raw === "object") return String((raw as Record<string, string>)[locale] ?? "");
  return "";
}

const TARGET_LABELS: Record<string, string> = {
  "hero.title": "首屏标题",
  "hero.subtitle": "首屏说明",
  "hero.cta": "首屏按钮",
  "about.title": "关于标题",
  "about.body": "公司简介",
  "features.title": "核心优势标题",
  "features.intro": "核心优势说明",
  "services.title": "服务标题",
  "services.intro": "服务说明",
  "products.title": "产品标题",
  "products.intro": "产品说明",
  "contact.title": "联系标题",
  "contact.body": "联系说明",
  "contact.address": "联系地址",
  "contact.email": "联系邮箱",
  "contact.phone": "联系电话",
  companyName: "品牌名称",
  siteName: "站点名称",
  industry: "所属行业",
  goal: "建站目标",
};

function targetLabel(target: string): string {
  if (TARGET_LABELS[target]) return TARGET_LABELS[target];
  if (target.startsWith("navigation.")) return `导航「${target.slice("navigation.".length)}」`;
  return target;
}
/** 该 slot 是否属于「就地编辑可处理」的范围（供 bridge 决定是否进入编辑态，避免无谓的编辑框） */
export function isInlineEditableSlot(slot: string, draft?: SiteDraft): boolean {
  if (!slot) return false;
  if (REJECTED_PREFIXES.some((prefix) => slot.startsWith(prefix))) return false;
  // 导航项（⑥）：`navigation.<id>[.<locale>]`。
  // **必须在通用的 `TEXT_SLOT` 之前判**——`TEXT_SLOT` 的 `[a-zA-Z.]` 吃不下
  // 数字和短横线，`navigation.about2` 会被它整条吃掉当成一个字段名，然后落空。
  //
  // ⚠️ 给了 `draft` 就**同时校验 id 真的存在**：模型完全可能输出一个草稿里
  // 没有的 id（它只看得见提示词里列的，看不见实际有哪些）。不校验的话，
  // 用户敲完字才在保存那步被拒——而 `slotToDraftOperation` 那时给的是
  // "该导航项已变化，请重新点击"，对着一个从没存在过的项说"已变化"很误导。
  const navMatch = NAV_SLOT.exec(slot);
  if (navMatch) {
    if (!draft) return true;
    return draft.navigation.some((item) => item.id === navMatch[1]);
  }
  if (CARD_SLOT.test(slot) || PRODUCT_SLOT.test(slot)) return true;
  /**
   * 评价与 Logo（⑥-4b）——**只在草稿里真的存在该项时**才算可编辑。
   *
   * 槽位用的是下标（`testimonials.items.0.quote`、`logos.0.name`），
   * 而下标会指到不存在的项上（模板换了、条目删了）。判宽了就是
   * "点了进编辑态、敲完字才报错"——正是这个函数要避免的。
   */
  const testimonialMatch = TESTIMONIAL_SLOT.exec(slot);
  if (testimonialMatch) {
    if (!draft) return true;
    const items = draft.content.testimonials?.items ?? [];
    const key = testimonialMatch[1];
    const index = /^\d+$/.test(key) ? Number(key) : items.findIndex((item) => item.id === key);
    return index >= 0 && index < items.length;
  }
  if (LOGO_SLOT.test(slot)) {
    if (!draft) return true;
    return Number(LOGO_SLOT.exec(slot)![1]) < draft.logos.length;
  }
  /**
   * 节标题（`faq.title` / `testimonials.title` / `.intro`）**还改不了**——
   * 显式拒绝，别让它落进下面 `matchesSetTextSlot` 的兜底。
   *
   * 原因：它们要走 `set_text`，而 `set_text` 的 target 白名单（`textTargets`）
   * 里没有这两项、`localizedValue` 也取不到。**不显式拒绝的话，`TEXT_SLOT`
   * 那个很宽的正则会让它们被判成可编辑**，用户敲完字才被拒——正是这个函数要防的。
   *
   * 补齐时只需往 `textTargets` + `localizedValue` 各加一行，然后把这条删掉。
   */
  if (/^(faq|testimonials)\.(title|intro)$/.test(slot)) return false;
  return matchesSetTextSlot(slot);
}

/**
 * `TEXT_SLOT` + 在可写白名单里 —— 与 `slotToDraftOperation` 的通用文本分支同口径。
 *
 * `siteName` / `companyName` / `industry` / `goal` 与 `contact.email` / `contact.phone`
 * 是**非本地化**字段，也一并认下。
 */
function matchesSetTextSlot(slot: string): boolean {
  const match = TEXT_SLOT.exec(slot);
  if (!match) return false;
  const target = match[1];
  return (
    SET_TEXT_TARGETS.has(target) ||
    NON_LOCALIZED_TARGETS.has(target) ||
    target === "siteName" ||
    target === "companyName" ||
    target === "industry" ||
    target === "goal"
  );
}
