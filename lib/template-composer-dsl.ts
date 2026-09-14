/**
 * 拼装引擎的 DSL（拼装说明书）。
 *
 * ## 这是什么
 *
 * 模型**不写 HTML**，只输出这份 DSL：选哪些组件、什么顺序、填什么内容、用什么配色。
 * 由 `composeTemplate()` 把它拼成真实 HTML。产出物因此是**确定性的**——
 * 模型选错组件的结果是"不好看"，模型写错 HTML 的结果是"页面塌了"，两者量级不同。
 *
 * ## 为什么内容字段直接复用 SiteDraft
 *
 * `content` 的形状**就是** `SiteDraft`。这样建站时 `POST /api/sites` 的 `initialDraft`
 * 可以**原样传**，一行转换都不用写。新造一套内容模型＝凭空多一层映射，且必然漂移。
 *
 * ## 本模块是纯函数，不碰 node:fs
 *
 * 与 `lib/template-runtime.ts` / `lib/template-runtime-loader.ts` 同一分工：
 * 纯逻辑与 fs 操作分开，否则 `node:fs` 会进客户端 bundle，
 * Turbopack 直接报 `does not support external modules` 而**构建失败**（实测）。
 */
import { MAX_COLLECTION_ITEMS, type DesignTokens, type SiteDraft } from "./site-document.ts";

// ---------------------------------------------------------------------------
// 组件类型与版式
// ---------------------------------------------------------------------------

/**
 * 组件清单。依据：22 个开源模板 + 2 个行业模板的板块出现率体检。
 *
 * | 组件 | 出现率 | 备注 |
 * |---|---|---|
 * | navbar / footer | 22/22 | 每站都有 |
 * | hero / features | 21/21 | **必须两式**——单式只覆盖约一半 |
 * | services | 15/21 | |
 * | about | 12/21 | 工业站标配 |
 * | products | 首页仅 fengji | 但五节模型必装 |
 * | contact | 22/22 | B2B 转化核心 |
 * | cta | 几乎所有落地页以此为尾 |
 * | faq | 13/22 | 2026-09-11 补 |
 * | testimonials | 12/22 | 2026-09-11 补 |
 * | logos | 9/22 | 2026-09-11 补 |
 */
export const COMPONENT_TYPES = [
  "navbar",
  "hero",
  "features",
  "services",
  "about",
  "products",
  "logos",
  "faq",
  "testimonials",
  "contact",
  "cta",
  "footer",
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * 每个组件支持的版式。**第一个是默认值**。
 *
 * ⚠️ **删版式 = 改历史产出物的形状**（2026-09-11 工时加进来）：
 * 已落盘的运行时模板的 HTML 早已生成，改这里的数组**不会**回头改它们，
 * 但会让**用那份 DSL 重新拼装**（例如重试、迁移）得到不同结果。
 * 所以只增不删；确实要删时，先把存量模板的 DSL 一起迁。
 */
export const COMPONENT_VARIANTS: Record<ComponentType, readonly string[]> = {
  navbar: ["simple", "contact-bar"],
  hero: ["split", "cover"],
  features: ["grid", "alternating"],
  services: ["cards"],
  about: ["split"],
  products: ["grid-4"],
  logos: ["row"],
  faq: ["accordion", "two-column"],
  testimonials: ["grid", "quote"],
  contact: ["split", "centered"],
  cta: ["centered"],
  footer: ["columns"],
} as const;

/**
 * 每个组件对应 SiteDraft 的哪一节。`null` = 静态组件（内容不来自 SiteDraft）。
 *
 * ⚠️ 这个映射是**编辑面板的基础**（M6）：点一个组件 → 面板要知道去读哪个字段。
 */
export const COMPONENT_SECTION: Record<ComponentType, "hero" | "about" | "features" | "services" | "products" | "faq" | "testimonials" | "logos" | "contact" | null> = {
  navbar: null,
  hero: "hero",
  features: "features",
  services: "services",
  about: "about",
  products: "products",
  logos: "logos",
  faq: "faq",
  testimonials: "testimonials",
  contact: "contact",
  cta: null,
  footer: null,
};

/**
 * 每个组件**可编辑的字段路径**（相对 `SiteDraft`）。
 *
 * ⚠️ 这是为 M6 的编辑面板预留的「反查」能力：给定组件，知道改哪些字段。
 * **现在就要写对**，否则届时改面板要回头动所有组件定义。
 */
export const COMPONENT_FIELDS: Record<ComponentType, readonly string[]> = {
  navbar: ["navigation.*"],
  hero: ["content.hero.title", "content.hero.subtitle", "content.hero.cta", "assets.hero.image"],
  features: ["content.features.title", "content.features.intro", "content.features.items[]"],
  services: ["content.services.title", "content.services.intro", "content.services.items[]"],
  about: ["content.about.title", "content.about.body"],
  products: ["content.products.title", "content.products.intro", "products[]"],
  logos: ["logos[].name", "logos[].logo"],
  faq: ["content.faq.title", "content.faq.intro", "content.faq.items[]"],
  testimonials: ["content.testimonials.title", "content.testimonials.intro", "content.testimonials.items[]"],
  contact: ["content.contact.title", "content.contact.body", "content.contact.email", "content.contact.phone", "content.contact.address"],
  cta: ["content.hero.cta"],
  footer: [],
} as const;

// ---------------------------------------------------------------------------
// DSL 结构
// ---------------------------------------------------------------------------

export type ComposerBlock = {
  type: ComponentType;
  /** 版式；省略时取 `COMPONENT_VARIANTS[type][0]`。 */
  variant?: string;
};

/**
 * 一份完整的拼装说明书。
 *
 * `templateId` 同时是**目录名**——运行时模板装载器用目录名当权威 id，
 * 两者不一致会在装载时被拒（防"按 A 查到、资源从 B 读"的静默错位）。
 * 格式：`^[a-z0-9][a-z0-9-]{0,39}$`。
 */
export type ComposerDsl = {
  templateId: string;
  /** 模板显示名（进模板库时用）。 */
  name: string;
  /** 站点名称（同时用于 `<title>`）。 */
  siteName: string;
  tokens: DesignTokens;
  blocks: readonly ComposerBlock[];
  content: SiteDraft;
};

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export type DslIssue = {
  path: string;
  message: string;
  /** `blocker` 会让拼装整体失败；`warning` 只记录。 */
  level: "blocker" | "warning";
};

const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * 集合槽上限——**定义在 `lib/site-document.ts`，这里是转出**。
 *
 * 2026-09-11 收敛：此前两边各写一个 `12`，提示词按一个数写、schema 按另一个数收，
 * 改一处必漂。漂了以后模型照着提示词给 13 条 → 被 schema 拒 → 报错信息只说
 * `too_big`，与提示词对不上，排查要靠人肉。
 */
export { MAX_COLLECTION_ITEMS };

/**
 * Logo 墙位置上限。
 *
 * **与 `MAX_COLLECTION_ITEMS` 不是同一个数**（24 vs 12）：Logo 是一行排列的窄格子，
 * 一屏能放开十几个；而 FAQ/评价是整幅卡片，12 张已经很长。共用一个数会逼出
 * "要么 logo 挤不下、要么问答只能写 12 条"的二选一。
 *
 * ⚠️ 必须与 `lib/site-document.ts` 里 `logos` 的 `.max(24)` 一致。
 */
export const MAX_LOGO_ITEMS = 24;

/**
 * DSL 静态校验。**纯函数，不抛异常**——把失败面收在一个明确返回列表的函数里，
 * 调用方（拼装器 / 门禁 / 重试循环）就不必用 try/catch 包住。
 */
export function validateDsl(dsl: ComposerDsl): DslIssue[] {
  const issues: DslIssue[] = [];

  if (!TEMPLATE_ID_PATTERN.test(dsl.templateId)) {
    issues.push({
      path: "templateId",
      message: `模板 id 必须匹配 ${TEMPLATE_ID_PATTERN}（小写字母/数字/短横线，40 字以内）`,
      level: "blocker",
    });
  }

  if (dsl.blocks.length === 0) {
    issues.push({ path: "blocks", message: "至少要有一个组件", level: "blocker" });
  }

  // hero.title 是全系统唯一的硬性必填槽（REQUIRED_RUNTIME_SLOTS），漏了过不了门禁。
  const hasHero = dsl.blocks.some((block) => block.type === "hero");
  if (!hasHero) {
    issues.push({
      path: "blocks",
      message: "缺少首屏（hero）——它是唯一被门禁硬性要求的板块",
      level: "blocker",
    });
  }

  dsl.blocks.forEach((block, index) => {
    if (!COMPONENT_TYPES.includes(block.type)) {
      issues.push({ path: `blocks[${index}].type`, message: `未知组件类型「${block.type}」`, level: "blocker" });
      return;
    }
    const variants = COMPONENT_VARIANTS[block.type];
    if (block.variant !== undefined && !variants.includes(block.variant)) {
      issues.push({
        path: `blocks[${index}].variant`,
        message: `组件「${block.type}」不支持版式「${block.variant}」，可选：${variants.join(" / ")}`,
        level: "blocker",
      });
    }
  });

  // 集合槽容量（schema 硬约束）。2026-09-11 起 faq / testimonials 也是集合槽——
  // 漏检它们的后果是模型给 20 条问答 → `composeTemplate` 说 ok → 建站时
  // `POST /api/sites` 的 siteDraftSchema 拒绝 → 用户看到的报错来自一个
  // 跟"拼装"毫不相干的接口。
  const { features, services, faq, testimonials } = dsl.content.content;
  const collections: ReadonlyArray<readonly [string, { items: readonly unknown[] } | undefined]> = [
    ["features", features],
    ["services", services],
    ["faq", faq],
    ["testimonials", testimonials],
  ];
  for (const [key, section] of collections) {
    if (section && section.items.length > MAX_COLLECTION_ITEMS) {
      issues.push({
        path: `content.${key}.items`,
        message: `${key} 最多 ${MAX_COLLECTION_ITEMS} 条，当前 ${section.items.length} 条`,
        level: "blocker",
      });
    }
  }

  // Logo 墙的上限在 site-document.ts 里是 24，与集合槽不是同一个数——
  // 单独判，别把它并进上面那个循环（那样会把上限悄悄改成 12）。
  if (dsl.content.logos.length > MAX_LOGO_ITEMS) {
    issues.push({
      path: "logos",
      message: `客户 Logo 最多 ${MAX_LOGO_ITEMS} 个，当前 ${dsl.content.logos.length} 个`,
      level: "blocker",
    });
  }

  if (!dsl.content.content.hero.title.zh.trim()) {
    issues.push({ path: "content.hero.title.zh", message: "首屏标题不能为空", level: "blocker" });
  }

  return issues;
}

/** 取组件实际生效的版式（未指定时用默认值）。 */
export function resolveVariant(block: ComposerBlock): string {
  return block.variant ?? COMPONENT_VARIANTS[block.type][0];
}
