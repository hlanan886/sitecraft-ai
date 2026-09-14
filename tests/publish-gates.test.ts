/**
 * 发布前资产门禁（L2b）单测。
 *
 * 存在的意义：`evaluateFidelity`/`detectAssetIssues`/`isHeroAssetDemo` 此前只被 scripts 与
 * 测试消费，发布链路完全没接。本测试锁死「门禁真的接线了」——包括**负例**（该拦的要拦）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { collectAssetGateWarnings } from "../lib/publish-gates.ts";
import { getHeroAsset, isHeroAssetDemo, isHeroAssetReplaceable } from "../lib/template-asset-registry.ts";

test("首屏是 demo 素材且未替换 → 发出警告", () => {
  const warnings = collectAssetGateWarnings({ templateId: "moon", assets: {} });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].patternKey, "hero_asset_registry_demo");
  assert.equal(warnings[0].severity, "high");
  assert.match(warnings[0].description, /模板示例图/);
});

test("用户已替换首屏图 → 不再警告", () => {
  const warnings = collectAssetGateWarnings({
    templateId: "moon",
    assets: { "hero.image": { url: "/uploads/hero.jpg", alt: "", mime: "image/jpeg", width: 1200, height: 800 } },
  });
  assert.equal(warnings.length, 0);
});

test("首屏不是 demo 素材的模板 → 不警告（无处可换，非缺陷）", () => {
  // shadcn-landing：首屏最大 img 实为 logo（demo: false）
  assert.equal(collectAssetGateWarnings({ templateId: "shadcn-landing", assets: {} }).length, 0);
  // signal：首屏只有内联 SVG
  assert.equal(collectAssetGateWarnings({ templateId: "signal", assets: {} }).length, 0);
  // powerai：首屏无 img
  assert.equal(collectAssetGateWarnings({ templateId: "powerai", assets: {} }).length, 0);
});

test("未知模板 fail-closed：不误报也不漏报（注册表无该模板 → 无警告）", () => {
  assert.equal(collectAssetGateWarnings({ templateId: "not-a-template", assets: {} }).length, 0);
});

test("注册表自洽：demo 为 true 的模板必须可替换（否则警告给不出替换入口）", () => {
  const demoTemplates = ["moon", "screwfast", "lonestone", "atlas", "forge", "landwind", "foxi", "yukina", "kindred", "tailwind-landing", "fresh", "astro-starter"];
  for (const templateId of demoTemplates) {
    assert.equal(isHeroAssetDemo(templateId), true, `${templateId} 应登记为 demo`);
    assert.equal(isHeroAssetReplaceable(templateId), true, `${templateId} demo=true 但不可替换 → 警告无解`);
    assert.ok(getHeroAsset(templateId)?.selector, `${templateId} 缺少 selector`);
  }
});
