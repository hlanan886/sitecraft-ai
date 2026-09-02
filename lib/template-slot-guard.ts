import type { SiteDraft } from "./site-document.ts";
import type { SiteOperation } from "./site-operations.ts";

const metadataTextTargets = new Set(["siteName", "industry", "goal"]);
const nonLocalizedTextTargets = new Set([
  "siteName",
  "companyName",
  "industry",
  "goal",
  "contact.email",
  "contact.phone",
]);

export type TemplateSlotPreflight = {
  unsupportedTargets: string[];
  nonVisualTargets: string[];
};

export type SelectedTargetConformance = {
  enforced: boolean;
  matches: boolean;
  operationTargets: string[];
};

/** Slots that the local SiteRenderer actually renders and can visibly update. */
export function buildLocalPreviewSlots(draft: SiteDraft) {
  const slots = [
    "companyName.zh",
    "industry.zh",
    ...(["zh", "en"] as const).flatMap((locale) => [
      `navigation.about.${locale}`,
      `navigation.services.${locale}`,
      `navigation.products.${locale}`,
      `navigation.contact.${locale}`,
      `hero.title.${locale}`,
      `hero.subtitle.${locale}`,
      `hero.cta.${locale}`,
      `about.title.${locale}`,
      `about.body.${locale}`,
      `services.title.${locale}`,
      `products.title.${locale}`,
      `contact.title.${locale}`,
      `contact.body.${locale}`,
      `contact.address.${locale}`,
    ]),
    "contact.email.zh",
    "about.visibility",
    "features.visibility",
    "services.visibility",
    "products.visibility",
    "contact.visibility",
  ];
  draft.content.services.items.forEach((_, index) => {
    (["zh", "en"] as const).forEach((locale) => {
      slots.push(`services.items.${index}.title.${locale}`, `services.items.${index}.body.${locale}`);
    });
  });
  draft.products.forEach((product) => {
    (["zh", "en"] as const).forEach((locale) => {
      slots.push(`products.${product.sku}.name.${locale}`, `products.${product.sku}.summary.${locale}`);
    });
    slots.push(`products.${product.sku}.category`);
  });
  return slots;
}

function canonicalSlot(value: string) {
  return value.replace(/\.(zh|en)$/, ".$locale");
}

function slotSupports(target: string, availableSlots: string[]) {
  const expected = canonicalSlot(target);
  return availableSlots.some((slot) => {
    const available = canonicalSlot(slot);
    return available === expected
      || available.startsWith(`${expected}.`)
      || expected.startsWith(`${available}.`);
  });
}

function textOperationTarget(operation: Extract<SiteOperation, { op: "set_text" }>) {
  const locale = nonLocalizedTextTargets.has(operation.target) ? "zh" : (operation.locale ?? "zh");
  return `${operation.target}.${locale}`;
}

export function operationDisplayTargets(operation: SiteOperation, draft: SiteDraft): string[] {
  if (operation.op === "set_text") return [textOperationTarget(operation)];
  if (operation.op === "update_card") {
    return [
      operation.title ? `${operation.section}.items.${operation.index}.title.${operation.locale}` : null,
      operation.body ? `${operation.section}.items.${operation.index}.body.${operation.locale}` : null,
    ].filter((target): target is string => Boolean(target));
  }
  if (operation.op === "add_card") {
    const index = Math.min(operation.index ?? draft.content[operation.section].items.length, draft.content[operation.section].items.length);
    return [`${operation.section}.items.${index}`];
  }
  if (operation.op === "remove_card") {
    const index = draft.content[operation.section].items.findIndex((item) => item.id === operation.itemId);
    return index < 0 ? [`${operation.section}.items`] : [`${operation.section}.items.${index}`];
  }
  if (operation.op === "update_product") {
    const locale = operation.locale ?? "zh";
    return [
      operation.name ? `products.${operation.sku}.name.${locale}` : null,
      operation.summary ? `products.${operation.sku}.summary.${locale}` : null,
      operation.category ? `products.${operation.sku}.category` : null,
    ].filter((target): target is string => Boolean(target));
  }
  if (operation.op === "set_section_visibility") return [`${operation.section}.visibility`];
  if (operation.op === "reorder_sections") return ["sections.order"];
  if (operation.op === "replace_products") return ["products"];
  return [];
}

/** Only exact document paths reported by the preview can override conversational context. */
export function isConcreteSelectedTarget(target?: string | null) {
  if (!target) return false;
  return /^(?:siteName|companyName|industry|goal|navigation\.(?:about|features|services|products|contact)|hero\.(?:title|subtitle|cta)|about\.(?:title|body)|features\.(?:title|intro)|services\.(?:title|intro)|products\.(?:title|intro)|contact\.(?:title|body|email|phone|address))\.(?:zh|en)$/.test(target)
    || /^(?:features|services)\.items\.\d+\.(?:title|body)\.(?:zh|en)$/.test(target)
    || /^products\..+\.(?:name|summary)\.(?:zh|en)$/.test(target)
    || /^products\..+\.category$/.test(target)
    || /^(?:about|features|services|products|contact)\.visibility$/.test(target)
    || target === "sections.order";
}

export function refersToSelectedTarget(message: string) {
  return /(?:选中|选的|选择的|刚才点|点击的|这个位置|该位置|这个字段|该字段|此处|这里|这处|selected|this (?:field|position|selection))/i.test(message);
}

export function shouldEnforceSelectedTarget(message: string, selectedTarget?: string | null) {
  return isConcreteSelectedTarget(selectedTarget) && refersToSelectedTarget(message);
}

function targetsAreRelated(selectedTarget: string, operationTarget: string) {
  return selectedTarget === operationTarget
    || selectedTarget.startsWith(`${operationTarget}.`)
    || operationTarget.startsWith(`${selectedTarget}.`);
}

/**
 * A referential edit with an exact preview slot must stay entirely inside that slot.
 * Group operations such as removing the selected card are accepted through path ancestry.
 */
export function checkSelectedTargetConformance(args: {
  message: string;
  selectedTarget?: string | null;
  operations: SiteOperation[];
  draft: SiteDraft;
}): SelectedTargetConformance {
  const enforced = shouldEnforceSelectedTarget(args.message, args.selectedTarget);
  const operationTargets = args.operations.flatMap((operation) => operationDisplayTargets(operation, args.draft));
  if (!enforced || !args.selectedTarget) return { enforced, matches: true, operationTargets };
  return {
    enforced,
    matches: operationTargets.length > 0
      && operationTargets.every((target) => targetsAreRelated(args.selectedTarget!, target)),
    operationTargets,
  };
}

export function selectedTargetMismatchMessage(selectedTarget: string) {
  return `模型未能将本次修改限定到已选位置（${selectedTarget}），草稿和历史均未修改。请重试，或重新点击右侧模板中的目标位置。`;
}

export function preflightTemplateSlots(args: {
  draft: SiteDraft;
  operations: SiteOperation[];
  availableSlots?: string[];
}): TemplateSlotPreflight {
  if (!args.availableSlots) return { unsupportedTargets: [], nonVisualTargets: [] };

  const availableSlots = [...new Set(args.availableSlots)];
  const unsupportedTargets = new Set<string>();
  const nonVisualTargets = new Set<string>();

  for (const operation of args.operations) {
    if (operation.op === "set_text" && metadataTextTargets.has(operation.target)) {
      const target = textOperationTarget(operation);
      if (!slotSupports(target, availableSlots)) nonVisualTargets.add(target);
      continue;
    }
    for (const target of operationDisplayTargets(operation, args.draft)) {
      if (!slotSupports(target, availableSlots)) unsupportedTargets.add(target);
    }
  }

  return {
    unsupportedTargets: [...unsupportedTargets],
    nonVisualTargets: [...nonVisualTargets],
  };
}

function describeTarget(target: string) {
  const card = target.match(/^(features|services)\.items\.(\d+)\.(title|body)\.(zh|en)$/);
  if (card) {
    const [, section, rawIndex, field, locale] = card;
    const sectionLabel = section === "features" ? "核心优势" : "服务";
    const fieldLabel = field === "title" ? "标题" : "说明";
    const localeLabel = locale === "zh" ? "中文" : "英文";
    return `第 ${Number(rawIndex) + 1} 个${sectionLabel}卡片的${localeLabel}${fieldLabel}（${target}）`;
  }
  const labels: Record<string, string> = {
    "companyName.zh": "页面品牌名称",
    "hero.title.zh": "中文首屏标题",
    "hero.title.en": "英文首屏标题",
    "hero.subtitle.zh": "中文首屏说明",
    "hero.subtitle.en": "英文首屏说明",
    "hero.cta.zh": "中文首屏按钮",
    "hero.cta.en": "英文首屏按钮",
    "sections.order": "页面区块顺序",
  };
  return labels[target] ? `${labels[target]}（${target}）` : target;
}

export function unsupportedTemplateSlotMessage(templateName: string, targets: string[]) {
  return `当前模板“${templateName}”没有可显示这些内容的位置：${targets.map(describeTarget).join("、")}。请点击右侧模板中希望承载这项内容的位置，再重新描述修改；系统会按你指出的具体位置处理。也可以先切换到包含对应模块的模板。`;
}

export const nonVisualTemplateNotice = "项目资料已保存；这类信息不属于当前模板页面内容，因此网站预览不会变化。";
