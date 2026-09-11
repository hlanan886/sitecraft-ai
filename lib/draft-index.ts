import type { ChatScope } from "./chat-task-planner.ts";
import type { SiteDraft } from "./site-document";

/**
 * 把草稿压缩成精简索引，避免整包草稿（尤其 1000 商品）撑爆上下文。
 * 商品 ≤ PRODUCT_INDEX_LIMIT 时返回完整草稿 JSON（兼容现有行为）；
 * 商品超出时，商品部分截断为 "SKU | 名称 | 分类" 列表，用户指令中明确提到的 SKU 优先完整保留。
 */
const PRODUCT_INDEX_LIMIT = 20;

export type DraftIndexScope = {
  sections: readonly ChatScope[];
  productSkus: readonly string[];
};

const contentKeys = ["hero", "about", "features", "services", "products", "contact"] as const;
type ContentKey = (typeof contentKeys)[number];

function isContentKey(value: ChatScope): value is ContentKey {
  return contentKeys.includes(value as ContentKey);
}

function buildScopedDraftIndex(draft: SiteDraft, message: string, scope: DraftIndexScope): string {
  const sections = [...new Set(scope.sections.filter(isContentKey))];
  const sectionSet = new Set<ContentKey>(sections);
  const mentionedSkus = draft.products
    .filter((product) => message.includes(product.sku))
    .map((product) => product.sku);
  const requestedSkus = new Set([...scope.productSkus, ...mentionedSkus]);
  const includeProducts = sectionSet.has("products");
  const products = includeProducts
    ? requestedSkus.size
      ? draft.products.filter((product) => requestedSkus.has(product.sku))
      : draft.products.slice(0, PRODUCT_INDEX_LIMIT)
    : undefined;
  const navigation = Object.fromEntries(
    sections
      .filter((section): section is Exclude<ContentKey, "hero"> => section !== "hero")
      .map((section) => [section, draft.navigation[section]]),
  );
  const content = Object.fromEntries(sections.map((section) => [section, draft.content[section]]));
  const orderedSections = draft.sectionOrder.filter((section) => sectionSet.has(section));
  const hiddenSections = draft.hiddenSections.filter((section) => sectionSet.has(section));

  return JSON.stringify({
    schemaVersion: draft.schemaVersion,
    siteName: draft.siteName,
    companyName: draft.companyName,
    templateId: draft.templateId,
    locale: draft.locale,
    revision: draft.revision,
    industry: draft.industry,
    goal: draft.goal,
    navigation,
    content,
    sectionOrder: orderedSections,
    hiddenSections,
    designTokens: draft.designTokens,
    ...(products ? { products } : {}),
  });
}

export function buildDraftIndex(draft: SiteDraft, message: string, scope?: DraftIndexScope): string {
  if (scope) return buildScopedDraftIndex(draft, message, scope);
  const products = draft.products;
  if (products.length <= PRODUCT_INDEX_LIMIT) return JSON.stringify(draft);
  const mentionedSkus = new Set<string>();
  for (const sku of products.map((p) => p.sku)) {
    if (message.includes(sku)) mentionedSkus.add(sku);
  }
  const kept = new Set<string>();
  // 优先完整保留用户提到的 SKU
  for (const sku of mentionedSkus) kept.add(sku);
  // 其余按顺序补足到上限
  for (const p of products) {
    if (kept.size >= PRODUCT_INDEX_LIMIT) break;
    kept.add(p.sku);
  }
  const keptProducts = products.filter((p) => kept.has(p.sku));
  const truncatedCount = products.length - keptProducts.length;
  // 保留的 SKU 保留完整字段（模型可能被要求完善其简介）；未保留的被裁剪掉
  const indexDraft: SiteDraft = {
    ...draft,
    products: keptProducts,
  };
  const json = JSON.stringify(indexDraft);
  // 在 JSON 后附加提示，说明商品被截断
  return truncatedCount > 0
    ? `${json}\n\n【注】当前草稿共 ${products.length} 个商品，已截断展示前 ${keptProducts.length} 个；如需修改其他商品，请提供其 SKU。`
    : json;
}
