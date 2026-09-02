import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import {
  buildLocalPreviewSlots,
  checkSelectedTargetConformance,
  isConcreteSelectedTarget,
  nonVisualTemplateNotice,
  preflightTemplateSlots,
  selectedTargetMismatchMessage,
  shouldEnforceSelectedTarget,
  unsupportedTemplateSlotMessage,
} from "../lib/template-slot-guard.ts";
import type { SiteOperation } from "../lib/site-operations.ts";

test("keeps direct API callers backward compatible when no slot report is provided", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "update_card", section: "services", index: 1, locale: "zh", title: "产线集成" }],
  });
  assert.deepEqual(result, { unsupportedTargets: [], nonVisualTargets: [] });
});

test("local preview capabilities only advertise fields rendered by SiteRenderer", () => {
  const slots = buildLocalPreviewSlots(defaultDraft);
  assert.ok(slots.includes("companyName.zh"));
  assert.ok(slots.includes("industry.zh"));
  assert.ok(slots.includes("navigation.services.en"));
  assert.ok(slots.includes("services.items.1.title.zh"));
  assert.ok(slots.includes("products.FM-2401.category"));
  assert.ok(slots.includes("features.visibility"));
  assert.equal(slots.includes("siteName.zh"), false);
  assert.equal(slots.includes("features.items.0.title.zh"), false);
  assert.equal(slots.includes("services.intro.zh"), false);
  assert.equal(slots.includes("contact.phone.zh"), false);
});

test("blocks a service card edit when the current template has no matching card slot", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "update_card", section: "services", index: 1, locale: "zh", title: "产线集成" }],
    availableSlots: ["companyName.zh", "hero.title.zh", "hero.subtitle.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, ["services.items.1.title.zh"]);
  assert.deepEqual(result.nonVisualTargets, []);
});

test("treats a slot in the other locale as the same template capability", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "set_text", target: "hero.title", locale: "en", value: "Reliable manufacturing" }],
    availableSlots: ["hero.title.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, []);
});

test("allows project metadata and reports that it is not template-visible", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "set_text", target: "siteName", locale: "zh", value: "华辰精工" }],
    availableSlots: ["companyName.zh", "hero.title.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, []);
  assert.deepEqual(result.nonVisualTargets, ["siteName.zh"]);
  assert.match(nonVisualTemplateNotice, /网站预览不会变化/);
});

test("treats project metadata as visible when a template explicitly maps it", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "set_text", target: "siteName", locale: "zh", value: "华辰精工" }],
    availableSlots: ["siteName.zh"],
  });
  assert.deepEqual(result, { unsupportedTargets: [], nonVisualTargets: [] });
});

test("blocks the whole multi-target change when any visible target is unsupported", () => {
  const operations: SiteOperation[] = [
    { op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" },
    { op: "update_card", section: "services", index: 1, locale: "zh", title: "产线集成" },
  ];
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations,
    availableSlots: ["hero.title.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, ["services.items.1.title.zh"]);
});

test("resolves a removed card id to its current visible index", () => {
  const item = defaultDraft.content.services.items[1];
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "remove_card", section: "services", itemId: item.id }],
    availableSlots: ["services.items.1.title.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, []);
});

test("does not apply old-template slots to an explicit template switch", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "set_template", templateId: "atlas" }],
    availableSlots: [],
  });
  assert.deepEqual(result.unsupportedTargets, []);
});

test("accepts a product summary when the generated product slot exists", () => {
  const result = preflightTemplateSlots({
    draft: defaultDraft,
    operations: [{ op: "update_product", sku: "FM-2401", locale: "en", summary: "Updated summary" }],
    availableSlots: ["products.FM-2401.summary.zh"],
  });
  assert.deepEqual(result.unsupportedTargets, []);
});

test("returns a clear unsupported-slot explanation", () => {
  const message = unsupportedTemplateSlotMessage("ASTROPLATE / Business", ["services.items.1.title.zh"]);
  assert.match(message, /没有可显示/);
  assert.match(message, /services\.items\.1\.title\.zh/);
  assert.match(message, /点击右侧模板/);
  assert.match(message, /按你指出的具体位置处理/);
});

test("rejects an old session target when the user refers to an exact selected slot", () => {
  const result = checkSelectedTargetConformance({
    message: "把我刚才选中的位置改成：精准智造，稳定交付",
    selectedTarget: "hero.title.zh",
    operations: [{ op: "update_card", section: "services", index: 1, locale: "zh", title: "精准智造" }],
    draft: defaultDraft,
  });
  assert.equal(result.enforced, true);
  assert.equal(result.matches, false);
  assert.deepEqual(result.operationTargets, ["services.items.1.title.zh"]);
});

test("accepts an operation that exactly targets the selected slot", () => {
  const result = checkSelectedTargetConformance({
    message: "把我刚才选中的位置改成：精准智造，稳定交付",
    selectedTarget: "hero.title.zh",
    operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "精准智造，稳定交付" }],
    draft: defaultDraft,
  });
  assert.equal(result.matches, true);
});

test("rejects extra fields outside the exact selected slot", () => {
  const result = checkSelectedTargetConformance({
    message: "修改我选中的首屏标题",
    selectedTarget: "hero.title.zh",
    operations: [
      { op: "set_text", target: "hero.title", locale: "zh", value: "精准智造" },
      { op: "set_text", target: "hero.subtitle", locale: "zh", value: "稳定交付" },
    ],
    draft: defaultDraft,
  });
  assert.equal(result.matches, false);
});

test("does not enforce generic UI target keys or explicit unrelated instructions", () => {
  assert.equal(isConcreteSelectedTarget("heroTitle"), false);
  assert.equal(shouldEnforceSelectedTarget("修改我选中的标题", "heroTitle"), false);
  assert.equal(shouldEnforceSelectedTarget("请把模板换成 atlas", "hero.title.zh"), false);

  const result = checkSelectedTargetConformance({
    message: "请把模板换成 atlas",
    selectedTarget: "hero.title.zh",
    operations: [{ op: "set_template", templateId: "atlas" }],
    draft: defaultDraft,
  });
  assert.deepEqual(result, { enforced: false, matches: true, operationTargets: [] });
});

test("selected-target mismatch message states that draft and history are unchanged", () => {
  assert.match(selectedTargetMismatchMessage("hero.title.zh"), /hero\.title\.zh/);
  assert.match(selectedTargetMismatchMessage("hero.title.zh"), /草稿和历史均未修改/);
});
