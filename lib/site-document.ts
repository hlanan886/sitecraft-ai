import { z } from "zod";

export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export type Device = "desktop" | "tablet" | "mobile";

export const localizedTextSchema = z.object({
  zh: z.string().max(1000),
  en: z.string().max(1000),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const editableCardSchema = z.object({
  id: z.string().min(1).max(80),
  title: localizedTextSchema,
  body: localizedTextSchema,
});
export type EditableCard = z.infer<typeof editableCardSchema>;

export const productSchema = z.object({
  sku: z.string().min(1).max(120),
  name: localizedTextSchema,
  summary: localizedTextSchema,
  category: z.string().max(120),
  status: z.enum(["published", "draft"]),
  imageColor: z.string().max(30),
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
export const sectionKeySchema = z.enum(sectionKeys);
export type SectionKey = z.infer<typeof sectionKeySchema>;

const contentSectionSchema = z.object({
  title: localizedTextSchema,
  intro: localizedTextSchema,
  items: z.array(editableCardSchema).max(12),
});

export const siteDraftSchema = z.object({
  schemaVersion: z.literal(2),
  siteName: z.string().min(1).max(120),
  companyName: z.string().min(1).max(120),
  templateId: z.string().min(1).max(80),
  locale: z.enum(locales),
  revision: z.number().int().nonnegative(),
  lastChange: z.string().max(240),
  industry: z.string().max(120),
  goal: z.string().max(500),
  navigation: z.object({
    about: localizedTextSchema,
    features: localizedTextSchema,
    services: localizedTextSchema,
    products: localizedTextSchema,
    contact: localizedTextSchema,
  }),
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
    contact: z.object({
      title: localizedTextSchema,
      body: localizedTextSchema,
      email: z.string().max(240),
      phone: z.string().max(80),
      address: localizedTextSchema,
    }),
  }),
  sectionOrder: z.array(sectionKeySchema).length(sectionKeys.length),
  hiddenSections: z.array(sectionKeySchema),
  products: z.array(productSchema).max(1000),
  supportConfig: z.object({
    enabled: z.boolean(),
    knowledgeSourceIds: z.array(z.string().max(120)).max(100),
  }),
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
  schemaVersion: 2,
  siteName: "Forge Industrial",
  companyName: "Forge Industrial",
  templateId: "forge",
  locale: "zh",
  revision: 1,
  lastChange: "草稿已保存",
  industry: "工业制造",
  goal: "展示核心产品与工程能力，获取全球客户询盘",
  navigation: {
    about: { zh: "关于", en: "About" },
    features: { zh: "优势", en: "Advantages" },
    services: { zh: "服务", en: "Services" },
    products: { zh: "产品", en: "Products" },
    contact: { zh: "联系", en: "Contact" },
  },
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
      body: {
        zh: "我们把工程、制造与交付能力放在同一个清晰体系中。企业事实尚未提供的部分将明确标记为待补充。",
        en: "We bring engineering, manufacturing and delivery into one clear system. Missing company facts remain explicitly marked for completion.",
      },
    },
    features: {
      title: { zh: "核心优势", en: "Core advantages" },
      intro: { zh: "围绕质量、交付和协作建立清晰价值。", en: "Clear value across quality, delivery and collaboration." },
      items: [
        { id: "quality", title: { zh: "质量可追溯", en: "Traceable quality" }, body: { zh: "关键过程与交付记录待客户资料补充。", en: "Key process and delivery records to be completed from customer data." } },
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
      intro: { zh: "以下内容可通过表格批量导入并继续由 AI 修改。", en: "Import this catalog in bulk and continue editing it with AI." },
    },
    contact: {
      title: { zh: "说说你的下一件事。", en: "Tell us what comes next." },
      body: { zh: "留下项目需求，我们会尽快与你联系。", en: "Share your requirements and our team will reply soon." },
      email: "hello@example.com",
      phone: "待补充",
      address: { zh: "地址待补充", en: "Address to be completed" },
    },
  },
  sectionOrder: ["about", "features", "services", "products", "contact"],
  hiddenSections: [],
  products: starterProducts,
  supportConfig: { enabled: false, knowledgeSourceIds: [] },
};

export function cloneDraft(draft: SiteDraft): SiteDraft {
  return structuredClone(draft);
}

export function normalizeDraft(input: unknown): SiteDraft {
  const parsed = siteDraftSchema.safeParse(input);
  if (parsed.success) return parsed.data;

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
