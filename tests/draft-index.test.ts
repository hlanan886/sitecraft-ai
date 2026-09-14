import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import { buildDraftIndex } from "../lib/draft-index.ts";

const templateIds = new Set(["forge", "kindred", "signal"]);

function draftWithNProducts(n: number) {
  const draft = structuredClone(defaultDraft);
  draft.products = Array.from({ length: n }, (_, i) => ({
    sku: `SKU-${String(i + 1).padStart(4, "0")}`,
    name: { zh: `产品${i + 1}`, en: `Product${i + 1}` },
    summary: { zh: `简介${i + 1}`, en: `summary${i + 1}` },
    category: "测试",
    status: "draft" as const,
    imageColor: "#ffffff",
  }));
  return draft;
}

test("index keeps full draft when products ≤ 20 (backward compatible)", () => {
  const small = draftWithNProducts(3);
  const idx = buildDraftIndex(small, "把首屏改一下");
  assert.equal(idx.includes("已截断展示"), false);
  assert.equal(idx.includes("SKU-0001"), true); // 完整 JSON 原样返回
});

test("index truncates products beyond 20 with a hint", () => {
  const big = draftWithNProducts(25);
  const idx = buildDraftIndex(big, "把首屏改一下");
  const skus = [...new Set((idx.match(/SKU-\d+/g) ?? []))];
  assert.equal(skus.length, 20);
  assert.equal(idx.includes("共 25 个商品"), true);
  assert.equal(idx.includes("已截断展示前 20 个"), true);
});

test("index prioritizes SKUs mentioned in the user message", () => {
  const big = draftWithNProducts(25);
  const idx = buildDraftIndex(big, "把 SKU-0024 的中文简介改一下");
  const skus = [...new Set((idx.match(/SKU-\d+/g) ?? []))];
  assert.equal(skus.includes("SKU-0024"), true);
  assert.equal(skus.length, 20);
});

test("scoped index includes only the requested content section", () => {
  const idx = buildDraftIndex(defaultDraft, "只改首屏标题", { sections: ["hero"], productSkus: [] });
  const parsed = JSON.parse(idx) as { content: Record<string, unknown>; products?: unknown };
  assert.deepEqual(Object.keys(parsed.content), ["hero"]);
  assert.equal(parsed.products, undefined);
  assert.ok(idx.length <= 12_000);
});

test("scoped product index keeps an explicitly mentioned SKU and omits unrelated sections", () => {
  const big = draftWithNProducts(25);
  const idx = buildDraftIndex(big, "把 SKU-0024 的简介改一下", { sections: ["products"], productSkus: ["SKU-0024"] });
  const parsed = JSON.parse(idx) as { content: Record<string, unknown>; products: Array<{ sku: string }> };
  assert.deepEqual(Object.keys(parsed.content), ["products"]);
  assert.deepEqual(parsed.products.map((product) => product.sku), ["SKU-0024"]);
});

test("scoped feature index preserves exact card positions", () => {
  const idx = buildDraftIndex(defaultDraft, "修改第二张优势卡片", { sections: ["features"], productSkus: [] });
  const parsed = JSON.parse(idx) as { content: { features: { items: Array<{ id: string }> } } };
  assert.equal(parsed.content.features.items[1].id, defaultDraft.content.features.items[1].id);
  assert.equal(parsed.content.features.items.length, defaultDraft.content.features.items.length);
});
