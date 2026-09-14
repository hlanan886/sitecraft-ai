import type { SiteDraft } from "./site-document.ts";
import type { SiteOperation } from "./site-operations.ts";
import type { Locale } from "./site-document.ts";
import { getTemplateManifest, getTemplatePresentation } from "./template-manifest.ts";

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

export type TemplateCapabilitySummary = {
  templateId: string;
  manifestVersion: number;
  locales: readonly Locale[];
  editableSlots: string[];
  requiredSlots: string[];
  nonContentSlots: string[];
  slotConstraints: Array<{
    target: string;
    semanticType: string;
    locales: readonly Locale[];
    maxLength: number;
    required: boolean;
    editable: boolean;
  }>;
  /**
   * 每业务槽在该模板的原生排版（role/capacity）。生成层据此按模板"能装几条、长什么样"
   * 组织内容，而不是为凑满通用槽位写一堆卡片。
   * 例：features=原生icon行,建议4条,max6。
   */
  presentation: Array<{
    /**
     * 模板原生排版的**业务段名**（裸名，如 `"features"`）。
     *
     * ⚠️ 与 DOM 的 `data-sitecraft-slot`（点分路径 `features.items.0.title.zh`）
     * **不是一个东西**——glossary「同名不同义」第 1 组。
     * 历史上两者都叫 `slot`，导致校验器按 `${section}.items` 去查裸段名、
     * 容量门**静默失效**（阶段 1 冲突 #1）。改名即为此。
     */
    presentationSlot: string;
    role: string;
    presentAs: string;
    capacityDefault?: number;
    capacityMax: number;
    itemShape: string;
    hideUnlessFilled?: boolean;
  }>;
};

export function buildTemplateCapabilitySummary(templateId: string, locale: Locale): TemplateCapabilitySummary {
  const manifest = getTemplateManifest(templateId);
  if (!manifest) {
    return {
      templateId,
      manifestVersion: 0,
      locales: [locale],
      editableSlots: [],
      requiredSlots: [],
      nonContentSlots: [],
      slotConstraints: [],
      presentation: [],
    };
  }
  return {
    templateId,
    manifestVersion: manifest.manifestVersion,
    locales: manifest.outputLocales,
    editableSlots: manifest.slots
      .filter((slot) => slot.editable && slot.locales.includes(locale))
      .map((slot) => slot.target),
    requiredSlots: manifest.slots.filter((slot) => slot.required).map((slot) => slot.target),
    nonContentSlots: manifest.nonContentSlots.map((slot) => slot.target),
    slotConstraints: manifest.slots.map((slot) => ({
      target: slot.target,
      semanticType: slot.semanticType,
      locales: slot.locales,
      maxLength: slot.maxLength,
      required: slot.required,
      editable: slot.editable,
    })),
    presentation: getTemplatePresentation(templateId).map((block) => ({
      presentationSlot: block.presentationSlot,
      role: block.role,
      presentAs: block.presentAs,
      capacityDefault: block.capacity.default,
      capacityMax: block.capacity.max,
      itemShape: block.itemShape,
      hideUnlessFilled: block.hideUnlessFilled,
    })),
  };
}

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
      // 导航项来自草稿本身（⑥ 起是数组，项数与 id 都由数据决定）——
      // 从前这里写死 4 个键**且漏了 `features`**，那个洞一直没人发现，
      // 因为漏掉的后果只是"这一项没出现在本地预览的槽位清单里"，不报错。
      ...draft.navigation.map((item) => `navigation.${item.id}.${locale}`),
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
  /**
   * `content.faq` 是**可选**的（图里没有 FAQ 的站不该被迫空着这一节）。
   * 这里只用来算"改的是第几条"，**找不到就给空数组**——
   * 空数组 = "没有可展示的目标"，调用方本来就按空处理。
   *
   * ⚠️ 不能在这里补一个空壳（`site-operations.ts` 的 `editableItems` 才补）：
   * 本函数是**只读**的展示工具，凭空往草稿里塞一节会污染下游的变更统计。
   */
  const itemsOf = (section: "features" | "services" | "faq") => draft.content[section]?.items ?? [];
  if (operation.op === "set_text") return [textOperationTarget(operation)];
  if (operation.op === "update_item") {
    const resolvedIndex = operation.itemId
      ? itemsOf(operation.section).findIndex((item) => item.id === operation.itemId)
      : operation.index;
    const index = resolvedIndex >= 0 ? resolvedIndex : operation.index;
    return [
      operation.title ? `${operation.section}.items.${index}.title.${operation.locale}` : null,
      operation.body ? `${operation.section}.items.${index}.body.${operation.locale}` : null,
    ].filter((target): target is string => Boolean(target));
  }
  if (operation.op === "add_item") {
    const count = itemsOf(operation.section).length;
    const index = Math.min(operation.index ?? count, count);
    return [`${operation.section}.items.${index}`];
  }
  if (operation.op === "remove_item") {
    const index = itemsOf(operation.section).findIndex((item) => item.id === operation.itemId);
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
  return /^(?:siteName|companyName|industry|goal|hero\.(?:title|subtitle|cta)|about\.(?:title|body)|features\.(?:title|intro)|services\.(?:title|intro)|products\.(?:title|intro)|contact\.(?:title|body|email|phone|address))\.(?:zh|en)$/.test(target)
    // 导航项的 id 是数据决定的（⑥），静态枚举装不下——这里用与
    // `inline-edit-mapping.ts` 的 NAV_SLOT 同一个字符集，两处别各写各的。
    || /^navigation\.[a-z0-9][a-z0-9-]{0,39}\.(?:zh|en)$/.test(target)
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

export type OperationTargetResolution = {
  targetId: string;
  confidence: "exact" | "ambiguous" | "missing";
};

/** 将预览的精确路径或卡片 itemId 解析为当前草稿位置；不唯一时拒绝猜测。 */
export function resolveOperationTarget(draft: SiteDraft, reference: string): OperationTargetResolution {
  const normalized = reference.trim();
  if (isConcreteSelectedTarget(normalized)) return { targetId: normalized, confidence: "exact" };
  const itemReference = normalized.match(/^(?:features|services)\.items\.(.+)$/)?.[1] ?? normalized;
  const matches = (["features", "services"] as const).flatMap((section) => {
    const index = draft.content[section].items.findIndex((item) => item.id === itemReference);
    return index >= 0 ? [`${section}.items.${index}`] : [];
  });
  if (matches.length === 1) return { targetId: matches[0], confidence: "exact" };
  if (matches.length > 1) return { targetId: normalized, confidence: "ambiguous" };
  return { targetId: normalized, confidence: "missing" };
}

export type OperationScopeValidation = {
  allowed: boolean;
  operationTargets: string[];
  reason?: string;
};

export function validateOperationScope(
  operation: SiteOperation,
  context: { message: string; selectedTarget?: string | null; draft: SiteDraft },
): OperationScopeValidation {
  const operationTargets = operationDisplayTargets(operation, context.draft);
  const enforced = shouldEnforceSelectedTarget(context.message, context.selectedTarget);
  if (!enforced || !context.selectedTarget) return { allowed: true, operationTargets };
  const allowed = operationTargets.length > 0 && operationTargets.every((target) => targetsAreRelated(context.selectedTarget!, target));
  return {
    allowed,
    operationTargets,
    ...(allowed ? {} : { reason: `操作目标超出用户选中的 ${context.selectedTarget}` }),
  };
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
export type TemplateSlotReportInput = {
  requiredTargets: readonly string[];
  appliedSlots: readonly string[];
  visibleSlots: readonly string[];
};

export type TemplateSlotReport = {
  appliedSlots: string[];
  visibleSlots: string[];
  missingSlots: string[];
  incompatible: boolean;
};

/**
 * 逻辑必需目标 → 槽位前缀的别名表（注册表驱动）。
 *
 * 说明：五节（about/features/services/products/contact）的前缀等于节名本身，
 * 已在 `slotMatchesTarget` 里由 fallback 覆盖，无需登记；这里只登记**名字与槽位不同**的别名
 * （heroTitle → hero.title 等）。新增此类目标时调用 `registerRequiredTargetPrefix` 一次即可，
 * 不要再改本表以外的任何地方（2026-09-09 泛化）。
 */
const requiredTargetPrefixes = new Map<string, readonly string[]>([
  ["brand", ["brand"]],
  ["heroTitle", ["hero.title"]],
  ["heroSubtitle", ["hero.subtitle"]],
  ["primaryCta", ["hero.cta"]],
]);

export function registerRequiredTargetPrefix(target: string, prefixes: readonly string[]): void {
  requiredTargetPrefixes.set(target, prefixes);
}

function slotMatchesTarget(slot: string, target: string) {
  const prefixes = requiredTargetPrefixes.get(target) ?? [target];
  return prefixes.some((prefix) => slot === prefix || slot.startsWith(prefix + "."));
}

export function evaluateTemplateSlotReport(input: TemplateSlotReportInput): TemplateSlotReport {
  const visibleSlots = [...new Set(input.visibleSlots)];
  const missingSlots = [...new Set(input.requiredTargets)].filter(
    (target) => !visibleSlots.some((slot) => slotMatchesTarget(slot, target)),
  );
  return {
    appliedSlots: [...new Set(input.appliedSlots)],
    visibleSlots,
    missingSlots,
    incompatible: missingSlots.length > 0,
  };
}
