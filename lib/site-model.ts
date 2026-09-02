import { templateCatalog } from "@/lib/template-catalog";
import {
  cloneDraft,
  defaultDraft,
  normalizeDraft,
  starterProducts,
  type Device,
  type EditableCard,
  type Locale,
  type LocalizedText,
  type Product,
  type SectionKey,
  type SiteDraft,
} from "@/lib/site-document";

export type TemplateCategory = "制造业" | "外贸目录" | "科技企业" | "专业服务";
export type TemplateTargetKey =
  | "brand"
  | "heroTitle"
  | "heroSubtitle"
  | "primaryCta"
  | "about"
  | "features"
  | "services"
  | "products"
  | "contact";

export type Template = {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  tags: string[];
  colors: { primary: string; secondary: string; accent: string };
  headline: string;
  subtitle: string;
  source: {
    name: string;
    repoUrl: string;
    license: "MIT" | "Internal";
    framework: string;
    demoUrl: string;
    localPath: string;
  };
  promptProfile: {
    role: string;
    structure: string[];
    visualRules: string[];
    targets: Array<{ key: TemplateTargetKey; label: string; guidance: string }>;
    guardrails: string[];
    starters: string[];
  };
};

export const templates: Template[] = templateCatalog;

export function getTemplate(id: string) {
  return templates.find((item) => item.id === id) ?? templates[0];
}

export function importProductsFromRows(
  draft: SiteDraft,
  rows: Record<string, string>[],
): { draft: SiteDraft; products: Product[]; imported: number; errors: string[] } {
  const next = cloneDraft(draft);
  const errors: string[] = [];
  let imported = 0;
  rows.slice(0, 1000).forEach((row, index) => {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), String(value ?? "").trim()]),
    );
    const sku = normalized.sku || normalized["产品编号"] || normalized["编码"];
    const name = normalized.name || normalized["产品名称"] || normalized["中文名称"];
    if (!sku || !name) {
      errors.push(`第 ${index + 2} 行缺少 SKU 或产品名称`);
      return;
    }
    const product: Product = {
      sku,
      name: { zh: name, en: normalized["name en"] || normalized["英文名称"] || name },
      summary: {
        zh: normalized.summary || normalized["产品简介"] || "待补充产品简介",
        en: normalized["summary en"] || normalized["英文简介"] || "Product description to be completed.",
      },
      category: normalized.category || normalized["分类"] || "未分类",
      status: "draft",
      imageColor: "#e6eee5",
      aiGenerated: !normalized.summary,
    };
    const existing = next.products.findIndex((item) => item.sku === sku);
    if (existing >= 0) next.products[existing] = product;
    else if (next.products.length < 1000) next.products.push(product);
    else {
      errors.push(`第 ${index + 2} 行超过单站 1000 个商品上限`);
      return;
    }
    imported += 1;
  });
  return { draft: next, products: next.products, imported, errors };
}

export { cloneDraft, defaultDraft, normalizeDraft, starterProducts };
export type { Device, EditableCard, Locale, LocalizedText, Product, SectionKey, SiteDraft };
