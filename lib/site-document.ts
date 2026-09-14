import { z } from "zod";
import { DRAFT_FIELD_MAX_LENGTH } from "./draft-field-limits.ts";

export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export type Device = "desktop" | "tablet" | "mobile";

export const localizedTextSchema = z.object({
  zh: z.string().max(1000),
  en: z.string().max(1000),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const editableItemSchema = z.object({
  id: z.string().min(1).max(80),
  title: localizedTextSchema,
  body: localizedTextSchema,
});
export type EditableItem = z.infer<typeof editableItemSchema>;

/**
 * 客户评价（2026-09-11，④ 组件扩充）。
 *
 * ## 为什么不是 `EditableItem`
 *
 * 评价有**两个出处**：卡片有 `title`/`body`，而评价是「谁说的 / 他什么身份 / 说了什么」。
 * 硬塞进 `EditableItem` 会让字段语义漂移（`title` 到底是人名还是标题？），
 * 而字段语义漂移正是 `CLAUDE.md` 第一条铁律要防的。
 *
 * ## `quote` 单独一字段而不是复用 `body`
 *
 * 渲染时 `quote` 要包 `<blockquote>`、`author` 要包 `<cite>` ——**节点不同**。
 * 复用 `body` 会让就地编辑改对文字却改错语义（`<cite>` 里塞一句正文）。
 */
export const testimonialSchema = z.object({
  id: z.string().min(1).max(80),
  /** 评价正文（模型从图里读到的原话）。 */
  quote: localizedTextSchema,
  /** 署名（客户名 / 公司名）。模型读不到时留空，渲染层不编造。 */
  author: localizedTextSchema,
  /** 身份（"某公司采购总监"）。读不到留空。 */
  role: localizedTextSchema,
});
export type Testimonial = z.infer<typeof testimonialSchema>;

/**
 * 客户 Logo 墙的一个位置。
 *
 * ## `name` 是必填的，即使有图
 *
 * 实测（2026-09-11 提配方时）：从截图里读公司名**极不可靠**，多数只能读到像素。
 * 但**没有 `name` 的 logo 格子在无障碍上是个空洞**（读屏念不出），
 * 且用户上传自己的 logo 后仍需要知道这格是谁。所以 `name` 必填、`logo` 可选：
 * **名字是事实，图是装饰**。读不到名字的格子宁可不渲染。
 */
export const logoSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  /** Logo 图 URL；无图时渲染文字标（不是空框）。 */
  logo: z.string().max(2000).optional(),
});
export type LogoItem = z.infer<typeof logoSchema>;

export const productSchema = z.object({
  sku: z.string().min(1).max(120),
  name: localizedTextSchema,
  summary: localizedTextSchema,
  category: z.string().max(120),
  status: z.enum(["published", "draft"]),
  imageColor: z.string().max(30),
  /** 主图 URL（本地 uploads 路径或完整 URL）；无图时渲染退回 imageColor 色块。 */
  image: z.string().max(2000).optional(),
  aiGenerated: z.boolean().optional(),
});
export type Product = z.infer<typeof productSchema>;

export const sectionKeys = [
  "about",
  "features",
  "services",
  "products",
  "contact",
] as const;

/**
 * 集合槽容量上限——**这里是单一来源**。
 *
 * 2026-09-11 收敛：此前 `contentSectionSchema` 里写死 `.max(12)`，
 * 而 `lib/template-composer-dsl.ts` 另有一个 `MAX_COLLECTION_ITEMS = 12`
 * 用来给模型写提示词。两个数各写各的，**改一处必漂**——漂了以后模型会照着
 * 提示词给 13 条，然后被 schema 拒绝，而报错信息只说"too_big"不与提示词对上。
 * 现在 DSL 侧直接 import 本常量。
 */
export const MAX_COLLECTION_ITEMS = 12;

/**
 * 草稿当前的 schemaVersion。
 *
 * **刻意不提版本号**：`faq` / `testimonials` / `logos` 是**纯增量可选字段**
 * （旧草稿缺它们时分别落成 `undefined` / `undefined` / `[]`），
 * 提版本号会走 `normalizeDraft` 的 legacy 分支 —— 那条分支只回填 7 个字段，
 * 会把 `about`/`features`/`services`/`contact`/`navigation` **全部重置成演示文案**。
 * 为了三个可选字段付这个代价是荒谬的。何时真需要提版本，见 `normalizeDraft` 的说明。
 */
export const DRAFT_SCHEMA_VERSION = 2 as const;
export const sectionKeySchema = z.enum(sectionKeys);
export type SectionKey = z.infer<typeof sectionKeySchema>;

/** 站点形态：企业官网 / 个人作品集 / 博客内容站。决定语义别名与生成/渲染取舍。 */
export const siteModels = ["corporate", "portfolio", "blog"] as const;
export const siteModelSchema = z.enum(siteModels);
export type SiteModel = (typeof siteModels)[number];

/** 导航项 id 的字符集。**它同时会进槽位路径**（`navigation.<id>.zh`），
 * 所以必须是 `inline-edit-mapping.ts` 的 `TEXT_SLOT` 能吃下的形态——
 * 那个正则只认小写字母、数字、点、短横线。放宽这里之前先看那边。 */
export const navigationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * 导航项上限。**单一来源**——`navItemSchema` 的数组与生成侧共用这一个数。
 *
 * 12 够放"6 个板块 + 几个下拉项"这类真实结构，又不至于让导航栏排出几屏。
 * 与 `MAX_COLLECTION_ITEMS` 一样，**不要在两处各写一个数字**：
 * 提示词按一个数写、schema 按另一个数收，改一处必漂。
 */
export const MAX_NAV_ITEMS = 12;

/**
 * 导航项的跳转目标。
 *
 * ⚠️ **只允许站内锚点**（`#about`），或空锚点 `#`。
 * 用户/模型填进来的字符串会直接进 `href`——不限制的话
 * `javascript:` 就是一条**存储型 XSS**，而且这个站是要发布出去的。
 * 校验放这里，别在渲染层各写一遍 `esc()` 就以为安全了（转义不拦协议）。
 */
export const navigationTargetSchema = z.string().max(120).regex(/^#[A-Za-z0-9_-]*$/);

/**
 * 一个导航项（2026-09-11，⑥ 导航数组化）。
 *
 * ## 为什么从「固定 5 键对象」改成数组
 *
 * 旧形状 `{ about, features, services, products, contact }` 是**结构写死的**，
 * 表达不了三样在 22 个开源模板里都真实存在的东西：
 * **6 项以上的导航**、**同一板块的两个入口**、**指向别处的入口**。
 * 更糟的是 21 个适配器因此只能靠「第 i 个键配第 i 个 href」工作——
 * 改一处顺序就全串位。
 *
 * ## `target` 是数据，不是从键名推出来的
 *
 * 旧代码靠「键名 === 节名」推 `href="#about"`。现在一个导航项指向哪里，
 * **看它自己的 `target`**，不看它是第几个、也不看它叫什么。
 */
export const navItemSchema = z.object({
  id: navigationIdSchema,
  label: localizedTextSchema,
  target: navigationTargetSchema,
});
export type NavItem = z.infer<typeof navItemSchema>;

export const designTokensSchema = z.object({
  primary: z.string().regex(/^#[0-9a-f]{6}$/i),
  secondary: z.string().regex(/^#[0-9a-f]{6}$/i),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  fontStyle: z.enum(["sans", "editorial", "technical"]),
  radius: z.enum(["sharp", "soft", "rounded"]),
  density: z.enum(["compact", "balanced", "spacious"]),
});
export type DesignTokens = z.infer<typeof designTokensSchema>;

const contentSectionSchema = z.object({
  title: localizedTextSchema,
  intro: localizedTextSchema,
  items: z.array(editableItemSchema).max(MAX_COLLECTION_ITEMS),
});

/** 可替换资产槽（P3.2）：首屏主视觉与品牌 Logo。能否替换由 lib/template-asset-registry.ts 逐模板声明。 */
export const assetTargets = ["hero.image", "brand.logo"] as const;
export const assetTargetSchema = z.enum(assetTargets);
export type AssetTarget = z.infer<typeof assetTargetSchema>;

export const draftAssetSchema = z.object({
  /** /api/product-images/xxx 或完整 URL；导出时由 buildOfflineHtml 转 data URI */
  url: z.string().min(1).max(2000),
  alt: z.string().max(200).optional(),
  mime: z.string().max(80).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  updatedAt: z.string().max(40).optional(),
});
export type DraftAsset = z.infer<typeof draftAssetSchema>;

export const draftAssetsSchema = z.object({
  "hero.image": draftAssetSchema.optional(),
  "brand.logo": draftAssetSchema.optional(),
});
export type DraftAssets = z.infer<typeof draftAssetsSchema>;

export const siteDraftSchema = z.object({
  schemaVersion: z.literal(DRAFT_SCHEMA_VERSION),
  // 上限取自 `lib/draft-field-limits.ts` 单一来源——它与写入侧的拦截共用同一份，
  // 避免"写入放行 1000、读取要求 120"导致整站静默回退（P-0，2026-09-11）。
  siteName: z.string().min(1).max(DRAFT_FIELD_MAX_LENGTH.siteName),
  companyName: z.string().min(1).max(DRAFT_FIELD_MAX_LENGTH.companyName),
  templateId: z.string().min(1).max(80),
  locale: z.enum(locales),
  revision: z.number().int().nonnegative(),
  lastChange: z.string().max(240),
  industry: z.string().max(DRAFT_FIELD_MAX_LENGTH.industry),
  goal: z.string().max(DRAFT_FIELD_MAX_LENGTH.goal),
  /** 站点形态：corporate 企业官网（默认）/ portfolio 个人作品集 / blog 博客内容站。 */
  siteModel: siteModelSchema.default("corporate"),
  /**
   * 导航项（2026-09-11，⑥ 数组化）。
   *
   * 上限 12：够放"6 个板块 + 下拉"这类真实结构，又不至于让导航栏排出几屏。
   * `.default([])` **不是**为了兼容旧数据——旧数据走 `migrateNavigation`，
   * 而是在于"一个还没有导航的草稿"是合法中间态（生成过程里会短暂存在）。
   */
  navigation: z.array(navItemSchema).max(MAX_NAV_ITEMS).default([]),
  content: z.object({
    hero: z.object({
      title: localizedTextSchema,
      subtitle: localizedTextSchema,
      cta: localizedTextSchema,
    }),
    about: z.object({
      title: localizedTextSchema,
      body: localizedTextSchema,
    }),
    features: contentSectionSchema,
    services: contentSectionSchema,
    products: z.object({
      title: localizedTextSchema,
      intro: localizedTextSchema,
    }),
    /**
     * FAQ（2026-09-11，④）。**可选**——22 个开源模板里约一半没有它，
     * 必填会把"本来就没有 FAQ 的正常站"变成非法草稿。
     *
     * 与 `products` 同样是「标题 + intro + 条目」三段，但**不复用
     * `contentSectionSchema`**：后者的 `items` 是 `EditableItem`
     * （`title`/`body` 语义是"小标题 + 正文"），而问答条目的
     * `question`/`answer` 在渲染上是 `<summary>`/正文，语义不同不能混用。
     */
    faq: contentSectionSchema.extend({
      items: z.array(editableItemSchema).max(MAX_COLLECTION_ITEMS),
    }).optional(),
    /** 客户评价（2026-09-11，④）。可选，理由同 FAQ。 */
    testimonials: contentSectionSchema.extend({
      items: z.array(testimonialSchema).max(MAX_COLLECTION_ITEMS),
    }).optional(),
    contact: z.object({
      title: localizedTextSchema,
      body: localizedTextSchema,
      email: z.string().max(DRAFT_FIELD_MAX_LENGTH["contact.email"]),
      phone: z.string().max(DRAFT_FIELD_MAX_LENGTH["contact.phone"]),
      address: localizedTextSchema,
    }),
  }),
  sectionOrder: z.array(sectionKeySchema).length(sectionKeys.length),
  hiddenSections: z.array(sectionKeySchema),
  designTokens: designTokensSchema.nullable().default(null),
  /** 可替换资产（P3.2）。旧草稿无此字段时 default({}) 补齐，schemaVersion 不变。 */
  assets: draftAssetsSchema.default({}),
  products: z.array(productSchema).max(1000),
  /**
   * 客户 Logo 墙（2026-09-11，④）。
   *
   * **放在顶层而不是 `content` 下**：它不是"有标题、有引言、有条目"的板块，
   * 而是一串平铺的客户位置（与 `products` 同形）。塞进 `contentSectionSchema`
   * 会逼出一个 `title`/`intro`/`items` 的空壳结构。
   */
  logos: z.array(logoSchema).max(24).default([]),
});
export type SiteDraft = z.infer<typeof siteDraftSchema>;

export const starterProducts: Product[] = [
  {
    sku: "FM-2401",
    name: { zh: "高精度模块", en: "Precision Module" },
    summary: {
      zh: "适用于连续生产线的高精度模块。",
      en: "High-precision module for continuous production lines.",
    },
    category: "核心组件",
    status: "published",
    imageColor: "#d7e7d1",
  },
  {
    sku: "FM-2402",
    name: { zh: "复合材料组件", en: "Composite Assembly" },
    summary: {
      zh: "轻量化、耐腐蚀的复合材料组件。",
      en: "Lightweight, corrosion-resistant composite assembly.",
    },
    category: "复合材料",
    status: "published",
    imageColor: "#e6e1cf",
  },
  {
    sku: "FM-2403",
    name: { zh: "智能检测单元", en: "Smart Inspection Unit" },
    summary: {
      zh: "面向质量控制的实时检测单元。",
      en: "Real-time inspection unit for quality control.",
    },
    category: "智能设备",
    status: "published",
    imageColor: "#d9e4ef",
  },
];

export const defaultDraft: SiteDraft = {
  schemaVersion: DRAFT_SCHEMA_VERSION,
  siteName: "Forge Industrial",
  companyName: "Forge Industrial",
  templateId: "forge",
  locale: "zh",
  revision: 1,
  lastChange: "草稿已保存",
  industry: "工业制造",
  goal: "展示核心产品与工程能力，获取全球客户询盘",
  siteModel: "corporate",
  navigation: [
    { id: "about", label: { zh: "关于", en: "About" }, target: "#about" },
    { id: "features", label: { zh: "优势", en: "Advantages" }, target: "#features" },
    { id: "services", label: { zh: "服务", en: "Services" }, target: "#services" },
    { id: "products", label: { zh: "产品", en: "Products" }, target: "#products" },
    { id: "contact", label: { zh: "联系", en: "Contact" }, target: "#contact" },
  ],
  content: {
    hero: {
      title: { zh: "为下一代标准而造。", en: "Built for the next standard." },
      subtitle: {
        zh: "从材料智能到生产确定性，为复杂制造提供可靠答案。",
        en: "From material intelligence to production certainty for complex manufacturing.",
      },
      cta: { zh: "查看产品能力", en: "Explore capabilities" },
    },
    about: {
      title: { zh: "为复杂项目，提供确定答案。", en: "Certainty for complex projects." },
      // 默认文案不得含内部说明语（"待补充"之类）——它是访客可见内容，
      // 且会被元说明检查拦下，导致新站一建好就发不出去（2026-09-08）。
      body: {
        zh: "我们把工程、制造与交付能力放在同一个清晰体系中。",
        en: "We bring engineering, manufacturing and delivery into one clear system.",
      },
    },
    features: {
      title: { zh: "核心优势", en: "Core advantages" },
      intro: { zh: "围绕质量、交付和协作建立清晰价值。", en: "Clear value across quality, delivery and collaboration." },
      items: [
        { id: "quality", title: { zh: "质量可追溯", en: "Traceable quality" }, body: { zh: "关键过程与交付记录可逐项核验。", en: "Key process and delivery records are verifiable item by item." } },
        { id: "delivery", title: { zh: "稳定交付", en: "Reliable delivery" }, body: { zh: "以明确节点组织评审、生产与交付。", en: "Clear milestones connect review, production and delivery." } },
        { id: "support", title: { zh: "快速协同", en: "Responsive collaboration" }, body: { zh: "为询价、打样和项目沟通提供统一入口。", en: "One clear path for RFQs, sampling and project communication." } },
      ],
    },
    services: {
      title: { zh: "从需求到持续交付", en: "From requirements to continuous delivery" },
      intro: { zh: "用清晰步骤推进每一次合作。", en: "A clear path through every engagement." },
      items: [
        { id: "discovery", title: { zh: "需求与评估", en: "Discovery and assessment" }, body: { zh: "梳理应用场景、规格与交付边界。", en: "Clarify applications, specifications and delivery boundaries." } },
        { id: "integration", title: { zh: "方案与实施", en: "Solution and implementation" }, body: { zh: "将需求转化为可评审、可执行的方案。", en: "Turn requirements into a reviewable, executable solution." } },
        { id: "delivery", title: { zh: "交付与支持", en: "Delivery and support" }, body: { zh: "围绕验收、反馈和后续支持持续协作。", en: "Continue collaboration through acceptance, feedback and support." } },
      ],
    },
    products: {
      title: { zh: "产品与能力", en: "Products and capabilities" },
      // 同理：不得写"可通过表格导入/AI 修改"这类操作说明——那是给站主看的，不是访客文案。
      intro: { zh: "以明确规格与稳定交付支撑持续合作。", en: "Clear specifications and reliable delivery for lasting partnerships." },
    },
    contact: {
      title: { zh: "说说你的下一件事。", en: "Tell us what comes next." },
      body: { zh: "留下项目需求，我们会尽快与你联系。", en: "Share your requirements and our team will reply soon." },
      // 与 phone/address 一致用缺口标记：此前是 hello@example.com，AI 会当成真实
      // 信息原样保留（实测样本即如此），访客看到假邮箱。缺口标记则会被质检识别、
      // 发布时隐藏，直到用户填入真实邮箱（2026-09-08）。
      email: "待补充",
      phone: "待补充",
      address: { zh: "地址待补充", en: "Address to be completed" },
    },
  },
  sectionOrder: ["about", "features", "services", "products", "contact"],
  hiddenSections: [],
  designTokens: null,
  assets: {},
  logos: [],
  // 2026-09-10：**不再预置演示商品**。此前 defaultDraft.products = starterProducts，
  // 于是每个新建站点默认带三个假 SKU（FM-2401 高精度模块 / FM-2402 复合材料组件 /
  // FM-2403 智能检测单元）。若 AI 生成未产出 products 板块（或用户没导入自己的商品），
  // **成品站会显示"别人的产品"**——而质检器不拦（`evaluateDraftQuality` 不校验商品是否为默认值），
  // 发布门也不拦。首个真实用例是东莞华冠（包装印刷），三个"精密模块"尤其突兀。
  // 空数组让渲染层自然回退到"无商品"状态（不显示 products 板块），
  // 由导入表格 / AI 生成 / 商品图上传填入真实数据。
  products: [],
};

export function cloneDraft(draft: SiteDraft): SiteDraft {
  return structuredClone(draft);
}

/**
 * 旧导航形状（固定 5 键对象）→ 数组。
 *
 * ## 为什么必须存在
 *
 * 2026-09-11 把 `navigation` 从对象改成数组（⑥）。**磁盘上每个旧草稿都是对象形状**，
 * 不迁移的话它们全都过不了 `siteDraftSchema`，然后掉进 `normalizeDraft` 的兜底分支——
 * **那一分支会把整站内容重置成 Forge 演示文案**（见下面的注释）。
 * 也就是说：不写这个函数，改 schema 的那一刻**所有现有站点的内容全部消失，且不报错**。
 *
 * ## 顺序必须保住
 *
 * 对象键的顺序（`about → features → services → products → contact`）**就是导航显示顺序**，
 * 所以用 `Object.entries` 而不是手工列键——手工列键会在将来加第六项时静默漏掉它。
 *
 * ## 认不出的形状返回 null，不猜
 *
 * 返回 `null` 表示"这不是我认识的旧导航"，调用方保持原值，让它照常走后面的兜底路径。
 * **返回一个空数组更糟**：那会把"没迁移成功"伪装成"这个站本来就没有导航"。
 */
export function migrateNavigation(value: unknown): NavItem[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items: NavItem[] = [];
  for (const [id, label] of Object.entries(value as Record<string, unknown>)) {
    // 键名要合法（它会进槽位路径 `navigation.<id>.zh`）；不合法就跳过这一项，
    // 而不是整批放弃——丢一项导航远好过丢掉整个导航。
    if (!navigationIdSchema.safeParse(id).success) continue;
    // 锚点取键名，与旧代码 `href="#${key}"` 的行为逐字一致
    const target = `#${id}`;
    if (!navigationTargetSchema.safeParse(target).success) continue;
    if (typeof label === "string") {
      items.push({ id, label: { zh: label, en: "" }, target });
      continue;
    }
    const parsedLabel = localizedTextSchema.safeParse(label);
    if (parsedLabel.success) items.push({ id, label: parsedLabel.data, target });
  }
  // 一个都没认出来 = 这不是旧导航（可能是别的东西），交给调用方按原值处理
  return items.length > 0 ? items : null;
}

export function normalizeDraft(input: unknown): SiteDraft {
  /**
   * 🔴 **迁移必须在 `safeParse` 之前**（2026-09-11，⑥）。
   *
   * `safeParse` 失败会掉到下面那条兜底分支，而那条只回填 7 个标量字段——
   * `navigation` / `about` / `features` / `services` / `contact` / `products`
   * **全部重置成 Forge 演示文案，且不报错**。
   * 所以"先试解析、失败再迁移"是错的：解析失败时用户的内容已经被判死刑了。
   */
  const migrated = migrateDraftShape(input);
  const parsed = siteDraftSchema.safeParse(migrated);
  if (parsed.success) return parsed.data;

  // 到这里的输入**真的**有问题——不是"版本旧一点"。
  // ⚠️ 下面这段是**破坏性**的：它把整站内容换成演示文案，只保留 7 个标量字段。
  // 历史上它吃掉过用户的真实内容（写入宽松 / 读取严格，P-0）。
  // 每次新增"结构变更"（像 ⑥ 的导航数组化）都**必须**在上面配一个迁移，
  // 否则就是又一次静默的数据丢失。
  const legacy = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const legacyHero = legacy.hero && typeof legacy.hero === "object"
    ? (legacy.hero as Record<string, unknown>)
    : {};
  const candidate = cloneDraft(defaultDraft);
  if (typeof legacy.siteName === "string" && legacy.siteName.trim()) candidate.siteName = legacy.siteName;
  if (typeof legacy.companyName === "string" && legacy.companyName.trim()) candidate.companyName = legacy.companyName;
  if (typeof legacy.templateId === "string" && legacy.templateId.trim()) candidate.templateId = legacy.templateId;
  if (typeof legacy.industry === "string") candidate.industry = legacy.industry;
  if (typeof legacy.goal === "string") candidate.goal = legacy.goal;
  if (typeof legacyHero.title === "string") candidate.content.hero.title.zh = legacyHero.title;
  if (typeof legacyHero.subtitle === "string") candidate.content.hero.subtitle.zh = legacyHero.subtitle;
  if (typeof legacyHero.cta === "string") candidate.content.hero.cta.zh = legacyHero.cta;
  const products = z.array(productSchema).max(1000).safeParse(legacy.products);
  if (products.success) candidate.products = products.data;
  return candidate;
}

/**
 * 把磁盘上的旧形状就地改成新形状。
 *
 * **只做能确定的事**：认不出来的字段原样返回，交给 `siteDraftSchema` 去判。
 * 这样后续每加一次迁移，只多一行，不会互相干扰。
 */
function migrateDraftShape(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const nav = migrateNavigation(record.navigation);
  return nav ? { ...record, navigation: nav } : record;
}
