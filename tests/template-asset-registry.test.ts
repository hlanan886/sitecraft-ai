import assert from "node:assert/strict";
import test from "node:test";

import {
  getHeroAsset,
  getHeroAssets,
  isHeroAssetDemo,
  isHeroAssetReplaceable,
  matchesHeroAssetSelector,
} from "../lib/template-asset-registry.ts";
import { templates } from "../lib/site-model.ts";

/**
 * A4 资产注册表契约测试（2026-09-09）。
 *
 * 该表同时服务两个用途：① 发布前门禁（首屏是否仍是 demo 素材）② P3.2 图片替换（能否替换）。
 * 因此必须与 catalog 的 22 个模板严格一一对应——漏登记 = 该模板静默失去门禁与替换能力。
 */

test("asset registry covers every catalog template exactly once", () => {
  const catalogIds = templates.map((template) => template.id).sort();
  const registeredIds = getHeroAssets().map((entry) => entry.templateId).sort();
  assert.deepEqual(registeredIds, catalogIds, "注册表必须与 template-catalog 的模板一一对应");
  assert.equal(new Set(registeredIds).size, registeredIds.length, "不得重复登记");
});

test("replaceable entries carry a selector; unsupported entries carry a reason", () => {
  for (const entry of getHeroAssets()) {
    if (entry.selector) {
      assert.equal(entry.unsupportedReason, undefined, `${entry.templateId} 有 selector 就不该再标 unsupported`);
    } else {
      assert.ok(entry.unsupportedReason, `${entry.templateId} 不支持替换时必须写明原因`);
    }
    assert.ok(entry.note.length > 0, `${entry.templateId} 缺少人工说明`);
  }
});

test("demo flag is only set on replaceable entries", () => {
  // demo 素材的前提是「能定位到那张图」——无 selector 却标 demo 是自相矛盾
  for (const entry of getHeroAssets()) {
    if (entry.demo) assert.ok(entry.selector, `${entry.templateId} 标了 demo 却没有 selector`);
  }
});

test("replaceable ratio matches the probe measurement", () => {
  const replaceable = getHeroAssets().filter((entry) => entry.selector);
  const unsupported = getHeroAssets().filter((entry) => !entry.selector);
  // scripts/probe-hero-asset.mjs 实测：14 个可定位 img，其中 shadcn-landing/astrofy 是 logo/小图需排除
  assert.equal(replaceable.length, 12, "可替换模板数应与探针实测一致（12）");
  assert.equal(unsupported.length, 10, "不支持替换的模板数应与探针实测一致（10）");
});

test("moon astronaut is flagged as demo while its background moon image is not", () => {
  assert.equal(isHeroAssetReplaceable("moon"), true);
  assert.equal(isHeroAssetDemo("moon"), true);
  assert.equal(matchesHeroAssetSelector("moon", "/_astro/astronaut.B8IC2jL3.webp"), true);
  assert.equal(matchesHeroAssetSelector("moon", "/_astro/moon.CJT1Acwy.webp"), false);
});

test("logo-only templates are not replaceable", () => {
  assert.equal(isHeroAssetReplaceable("shadcn-landing"), false);
  assert.equal(getHeroAsset("shadcn-landing")?.unsupportedReason, "logo_only");
  assert.equal(isHeroAssetReplaceable("astrofy"), false);
});

test("unknown template id is fail-closed", () => {
  assert.equal(isHeroAssetReplaceable("not-a-template"), false);
  assert.equal(isHeroAssetDemo("not-a-template"), false);
  assert.equal(getHeroAsset("not-a-template"), undefined);
  assert.equal(matchesHeroAssetSelector("not-a-template", "anything"), false);
});
