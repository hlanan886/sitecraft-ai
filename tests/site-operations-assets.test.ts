import assert from "node:assert/strict";
import test from "node:test";

import { applySiteOperations, siteOperationSchema } from "../lib/site-operations.ts";
import { cloneDraft, defaultDraft, type SiteDraft } from "../lib/site-document.ts";

/**
 * P3.2 资产替换操作测试（2026-09-09）。
 *
 * `set_asset` 是首个「非文本」用户操作，必须验证：
 *  - 只进用户操作白名单，不进 AI 白名单（AI 不能上传图片）
 *  - 撤销走显式逆操作（不能依赖 replace_draft 兜底——它只覆盖自身分支）
 *  - asset: null 表示恢复模板原图
 */

const templateIds = new Set(["forge", "moon", "tailwind-landing"]);
const apply = (draft: SiteDraft, operations: Parameters<typeof applySiteOperations>[1]) =>
  applySiteOperations(draft, operations, { templateIds, lastChange: "测试" });

const heroAsset = { url: "/api/product-images/hero.png", alt: "厂区实拍", mime: "image/png" };

test("set_asset writes the asset and reports the target", () => {
  const draft = cloneDraft(defaultDraft);
  const result = apply(draft, [{ op: "set_asset", target: "hero.image", asset: heroAsset }]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.appliedTargets, ["hero.image"]);
  assert.deepEqual(result.draft.assets["hero.image"], heroAsset);
  assert.equal(result.draft.revision, draft.revision + 1);
});

test("set_asset inverse operation restores the previous asset", () => {
  const draft = cloneDraft(defaultDraft);
  draft.assets = { "hero.image": { url: "/api/product-images/old.png" } };
  const result = apply(draft, [{ op: "set_asset", target: "hero.image", asset: heroAsset }]);
  // 逆操作必须显式携带旧值——若依赖 replace_draft 兜底，撤销时图片不会回退
  assert.deepEqual(result.inverseOperations, [
    { op: "set_asset", target: "hero.image", asset: { url: "/api/product-images/old.png" } },
  ]);
  const undone = apply(result.draft, result.inverseOperations);
  assert.deepEqual(undone.draft.assets["hero.image"], { url: "/api/product-images/old.png" });
});

test("set_asset with null removes the asset (restore template original)", () => {
  const draft = cloneDraft(defaultDraft);
  draft.assets = { "hero.image": heroAsset };
  const result = apply(draft, [{ op: "set_asset", target: "hero.image", asset: null }]);
  assert.equal(result.draft.assets["hero.image"], undefined);
  assert.deepEqual(result.inverseOperations, [{ op: "set_asset", target: "hero.image", asset: heroAsset }]);
});

test("setting the same asset twice is a no-op", () => {
  const draft = cloneDraft(defaultDraft);
  draft.assets = { "hero.image": heroAsset };
  const result = apply(draft, [{ op: "set_asset", target: "hero.image", asset: heroAsset }]);
  assert.equal(result.changed, false);
  assert.equal(result.draft, draft);
});

test("clearing an absent asset is a no-op", () => {
  const draft = cloneDraft(defaultDraft);
  const result = apply(draft, [{ op: "set_asset", target: "hero.image", asset: null }]);
  assert.equal(result.changed, false);
});

test("brand.logo is an independent target", () => {
  const draft = cloneDraft(defaultDraft);
  const result = apply(draft, [
    { op: "set_asset", target: "hero.image", asset: heroAsset },
    { op: "set_asset", target: "brand.logo", asset: { url: "/api/product-images/logo.svg" } },
  ]);
  assert.deepEqual(result.appliedTargets, ["hero.image", "brand.logo"]);
  assert.equal(result.draft.assets["brand.logo"]?.url, "/api/product-images/logo.svg");
  assert.equal(result.draft.assets["hero.image"]?.url, heroAsset.url);
});

test("set_asset is accepted by the user operation schema but rejected for AI", async () => {
  const { aiOperationSchema } = await import("../lib/site-operations.ts");
  const operation = { op: "set_asset", target: "hero.image", asset: heroAsset };
  assert.equal(siteOperationSchema.safeParse(operation).success, true);
  assert.equal(aiOperationSchema.safeParse(operation).success, false);
});

test("set_asset rejects unknown targets and malformed assets", () => {
  assert.equal(siteOperationSchema.safeParse({ op: "set_asset", target: "footer.image", asset: heroAsset }).success, false);
  assert.equal(siteOperationSchema.safeParse({ op: "set_asset", target: "hero.image", asset: { url: "" } }).success, false);
  assert.equal(siteOperationSchema.safeParse({ op: "set_asset", target: "hero.image" }).success, false);
});

test("draft schema fills assets for legacy drafts without the field", () => {
  const legacy = cloneDraft(defaultDraft) as Partial<SiteDraft>;
  delete legacy.assets;
  const parsed = siteOperationSchema.safeParse({ op: "set_asset", target: "hero.image", asset: null });
  assert.equal(parsed.success, true);
  // 旧草稿经 normalizeDraft 后必须带 assets: {}
  assert.deepEqual(cloneDraft(defaultDraft).assets, {});
});
