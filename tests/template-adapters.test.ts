import assert from "node:assert/strict";
import test from "node:test";

import { getTemplateAdapter, templateAdapters } from "../lib/template-adapters/index.ts";
import { forgeAdapter } from "../lib/template-adapters/forge.ts";
import { atlasAdapter } from "../lib/template-adapters/atlas.ts";
import { poweraiAdapter } from "../lib/template-adapters/powerai.ts";
import { signalAdapter } from "../lib/template-adapters/signal.ts";
import { moonAdapter } from "../lib/template-adapters/moon.ts";
import { astrofyAdapter } from "../lib/template-adapters/astrofy.ts";
import { devportfolioAdapter } from "../lib/template-adapters/devportfolio.ts";
import { astropaperAdapter } from "../lib/template-adapters/astropaper.ts";
import { yukinaAdapter } from "../lib/template-adapters/yukina.ts";

test("template adapters registry carries the per-template rules only", () => {
  // forge 是全量适配：servicesFn + designTokenCss + sanitize 齐备
  const forge = getTemplateAdapter("forge");
  assert.equal(forge, forgeAdapter);
  assert.equal(forge?.templateId, "forge");
  assert.ok(forge?.servicesFn, "forge servicesFn should declare native service-card adapter");
  assert.ok(forge?.designTokenCss, "forge design token css present");
  assert.ok(forge?.sanitize?.leafPatterns?.length, "forge published sanitize present");
  // 无适配模板拿不到任何适配
  assert.equal(getTemplateAdapter("not-a-template"), undefined);
});

test("adapters migrated from shared route preserve prior rules", () => {
  // atlas 仍是占位迁移；powerai/signal 已在 B 档升级为完整适配（prepareFn+nativeFillFn+designTokenCss）
  assert.ok(atlasAdapter.sanitize?.sections?.length, "atlas published sanitize present");
  assert.ok(atlasAdapter.designTokenCss, "atlas design token css present");
  assert.equal(atlasAdapter.servicesFn, undefined, "atlas no custom servicesFn yet");

  assert.ok(poweraiAdapter.sanitize?.leafPatterns && poweraiAdapter.sanitize.leafPatterns.length >= 2, "powerai sanitize present");
  assert.ok(poweraiAdapter.prepareFn, "powerai prepareFn after B-tier expansion");
  assert.ok(poweraiAdapter.nativeFillFn, "powerai nativeFillFn after B-tier expansion");

  assert.ok(signalAdapter.designTokenCss, "signal design token css present");
  assert.ok(signalAdapter.prepareFn, "signal prepareFn after B-tier expansion");
  assert.ok(signalAdapter.nativeFillFn, "signal nativeFillFn after B-tier expansion");
  assert.equal(signalAdapter.servicesFn, undefined, "signal has no custom servicesFn");

  // 每个注册表项与自身 templateId 一致，且不存在悬空引用
  for (const [templateId, adapter] of Object.entries(templateAdapters)) {
    assert.equal(adapter.templateId, templateId);
  }
});

test("moon adapter carries heroFn for its non-h1 visible hero", () => {
  const moon = getTemplateAdapter("moon");
  assert.equal(moon, moonAdapter);
  assert.ok(moon?.heroFn, "moon heroFn should locate the visible gradient h2 hero title");
  assert.match(moon!.heroFn!, /gradient-text/, "heroFn references moon gradient hero class");
  assert.equal(moon?.servicesFn, undefined, "moon has no custom servicesFn");
});
test("content-site adapters are registered with native fill contracts", () => {
  for (const [templateId, adapter] of [
    ["astrofy", astrofyAdapter],
    ["devportfolio", devportfolioAdapter],
    ["astropaper", astropaperAdapter],
    ["yukina", yukinaAdapter],
  ] as const) {
    assert.equal(getTemplateAdapter(templateId), adapter);
    assert.equal(adapter.templateId, templateId);
    assert.ok(adapter.prepareFn);
    assert.ok(adapter.nativeFillFn);
    assert.equal(adapter.prepareFn!.includes("${"), false);
    assert.equal(adapter.nativeFillFn!.includes("${"), false);
  }
});

test("content adapters keep stable native anchors across repeated prepare calls", () => {
  assert.match(astrofyAdapter.prepareFn!, /sitecraftAstrofyContact/);
  assert.match(devportfolioAdapter.prepareFn!, /getElementById\('projects'\)/);
  assert.doesNotMatch(devportfolioAdapter.prepareFn!, /projects\.id\s*=\s*['"]features/);
});

