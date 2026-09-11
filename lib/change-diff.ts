import { applySiteOperations, type SiteOperation } from "./site-operations.ts";
import { operationDisplayTargets } from "./template-slot-guard.ts";
import { templates, type SiteDraft } from "./site-model.ts";

export type ChangeDiff = {
  target: string;
  label: string;
  before: string;
  after: string;
};

const templateIds = new Set(templates.map((template) => template.id));

const textLabels: Record<string, string> = {
  siteName: "站点名称",
  companyName: "企业名称",
  industry: "所属行业",
  goal: "建站目标",
  "navigation.about": "关于导航",
  "navigation.features": "优势导航",
  "navigation.services": "服务导航",
  "navigation.products": "产品导航",
  "navigation.contact": "联系导航",
  "hero.title": "首屏标题",
  "hero.subtitle": "首屏说明",
  "hero.cta": "首屏按钮",
  "about.title": "关于标题",
  "about.body": "关于说明",
  "features.title": "优势标题",
  "features.intro": "优势说明",
  "services.title": "服务标题",
  "services.intro": "服务说明",
  "products.title": "产品标题",
  "products.intro": "产品说明",
  "contact.title": "联系标题",
  "contact.body": "联系说明",
  "contact.email": "联系邮箱",
  "contact.phone": "联系电话",
  "contact.address": "联系地址",
};

const localeLabels: Record<string, string> = { zh: "中文", en: "英文" };
const sectionLabels: Record<string, string> = {
  about: "关于",
  features: "核心优势",
  services: "服务",
  products: "产品",
  contact: "联系",
};

function readTextTarget(draft: SiteDraft, target: string, locale: "zh" | "en"): string {
  switch (target) {
    case "siteName": return draft.siteName;
    case "companyName": return draft.companyName;
    case "industry": return draft.industry;
    case "goal": return draft.goal;
    case "navigation.about": return draft.navigation.about[locale];
    case "navigation.features": return draft.navigation.features[locale];
    case "navigation.services": return draft.navigation.services[locale];
    case "navigation.products": return draft.navigation.products[locale];
    case "navigation.contact": return draft.navigation.contact[locale];
    case "hero.title": return draft.content.hero.title[locale];
    case "hero.subtitle": return draft.content.hero.subtitle[locale];
    case "hero.cta": return draft.content.hero.cta[locale];
    case "about.title": return draft.content.about.title[locale];
    case "about.body": return draft.content.about.body[locale];
    case "features.title": return draft.content.features.title[locale];
    case "features.intro": return draft.content.features.intro[locale];
    case "services.title": return draft.content.services.title[locale];
    case "services.intro": return draft.content.services.intro[locale];
    case "products.title": return draft.content.products.title[locale];
    case "products.intro": return draft.content.products.intro[locale];
    case "contact.title": return draft.content.contact.title[locale];
    case "contact.body": return draft.content.contact.body[locale];
    case "contact.email": return draft.content.contact.email;
    case "contact.phone": return draft.content.contact.phone;
    case "contact.address": return draft.content.contact.address[locale];
    default: return "";
  }
}

function readDisplayTarget(draft: SiteDraft, target: string): string {
  const text = target.match(/^(.+)\.(zh|en)$/);
  if (text && textLabels[text[1]]) return readTextTarget(draft, text[1], text[2] as "zh" | "en");

  const card = target.match(/^(features|services)\.items\.(\d+)\.(title|body)\.(zh|en)$/);
  if (card) {
    const item = draft.content[card[1] as "features" | "services"].items[Number(card[2])];
    if (!item) return "";
    return item[card[3] as "title" | "body"][card[4] as "zh" | "en"];
  }

  const product = target.match(/^products\.([^\.]+)\.(name|summary)\.(zh|en)$/);
  if (product) {
    const item = draft.products.find((candidate) => candidate.sku === product[1]);
    return item?.[product[2] as "name" | "summary"][product[3] as "zh" | "en"] ?? "";
  }
  const productCategory = target.match(/^products\.([^\.]+)\.category$/);
  if (productCategory) return draft.products.find((candidate) => candidate.sku === productCategory[1])?.category ?? "";
  const visibility = target.match(/^(about|features|services|products|contact)\.visibility$/);
  if (visibility) return draft.hiddenSections.includes(visibility[1] as "about" | "features" | "services" | "products" | "contact") ? "隐藏" : "显示";
  if (target === "sections.order") return draft.sectionOrder.join("、");
  return target === "template" ? draft.templateId : "";
}

function displayLabel(target: string): string {
  const text = target.match(/^(.+)\.(zh|en)$/);
  if (text && textLabels[text[1]]) return `${textLabels[text[1]]}（${localeLabels[text[2]]}）`;
  const card = target.match(/^(features|services)\.items\.(\d+)\.(title|body)\.(zh|en)$/);
  if (card) {
    const section = card[1] === "features" ? "核心优势" : "服务";
    const field = card[3] === "title" ? "标题" : "说明";
    return `第 ${Number(card[2]) + 1} 个${section}${field}（${localeLabels[card[4]]}）`;
  }
  const product = target.match(/^products\.([^\.]+)\.(name|summary)\.(zh|en)$/);
  if (product) return `商品 ${product[1]} ${product[2] === "name" ? "名称" : "简介"}（${localeLabels[product[3]]}）`;
  if (target.endsWith(".category")) return `商品 ${target.split(".")[1]} 分类`;
  if (target.endsWith(".visibility")) return `${sectionLabels[target.split(".")[0]] ?? target.split(".")[0]}区块显示状态`;
  if (target === "sections.order") return "区块显示顺序";
  if (target === "template") return "网站模板";
  return target;
}

function operationTargets(operation: SiteOperation, draft: SiteDraft): string[] {
  const targets = operationDisplayTargets(operation, draft);
  if (targets.length) return targets;
  if (operation.op === "set_template") return ["template"];
  if (operation.op === "set_design_tokens") return ["design.tokens"];
  if (operation.op === "replace_draft") return ["draft"];
  return [];
}

/** Build a compact field-level preview from the same operations the server applies. */
export function buildChangeDiff(operations: SiteOperation[], before: SiteDraft): ChangeDiff[] {
  let applied: ReturnType<typeof applySiteOperations>;
  try {
    applied = applySiteOperations(before, operations, { templateIds, lastChange: "AI 修改预览" });
  } catch {
    // Diff is a presentation aid; an old target must never turn a committed response into a UI error.
    return [];
  }
  if (!applied.changed) return [];
  const after = applied.draft;
  const targets = [...new Set(operations.flatMap((operation) => operationTargets(operation, before)))];
  return targets
    .map((target) => ({
      target,
      label: displayLabel(target),
      before: readDisplayTarget(before, target),
      after: readDisplayTarget(after, target),
    }))
    .filter((item) => item.before !== item.after);
}
