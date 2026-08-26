import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import {
  applySiteOperations,
  validateAIOperations,
  type SiteOperation,
} from "../lib/site-operations.ts";

const templateIds = new Set(["forge", "kindred", "signal"]);

test("updates only the requested service card and creates a reversible operation", () => {
  const original = structuredClone(defaultDraft);
  const result = applySiteOperations(original, [{
    op: "update_card",
    section: "services",
    index: 1,
    locale: "zh",
    title: "智能产线集成",
  }], { templateIds, lastChange: "AI saved" });

  assert.equal(result.changed, true);
  assert.equal(result.draft.templateId, "forge");
  assert.equal(result.draft.content.services.items[1].title.zh, "智能产线集成");
  assert.equal(result.draft.content.services.items[0].title.zh, original.content.services.items[0].title.zh);
  assert.deepEqual(result.appliedTargets, ["services.items.1.title.zh"]);
  assert.equal(result.draft.revision, original.revision + 1);

  const restored = applySiteOperations(result.draft, result.inverseOperations, { templateIds, lastChange: "Undo" });
  assert.equal(restored.draft.content.services.items[1].title.zh, original.content.services.items[1].title.zh);
  assert.equal(restored.draft.templateId, original.templateId);
});

test("rejects an unsolicited template switch", () => {
  const validated = validateAIOperations("只修改第二个服务标题", [
    { op: "set_template", templateId: "kindred" },
    { op: "update_card", section: "services", index: 1, locale: "zh", title: "智能产线集成" },
  ], templateIds);
  assert.equal(validated.operations.length, 1);
  assert.equal(validated.operations[0].op, "update_card");
  assert.match(validated.rejected[0], /拒绝模板切换/);
});

test("allows a whitelisted template switch only when explicitly requested", () => {
  const validated = validateAIOperations("请切换模板为 kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("allows a template switch in '模板换成' word order", () => {
  // 回归：实测中"请把模板换成 atlas"被正则误拒（名词在前语序未匹配）
  const validated = validateAIOperations("请把模板换成 kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("allows a template switch with English 'switch template' order", () => {
  const validated = validateAIOperations("switch template to kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("does not increment revision for a no-op", () => {
  const operation: SiteOperation = {
    op: "set_text",
    target: "hero.title",
    locale: "zh",
    value: defaultDraft.content.hero.title.zh,
  };
  const result = applySiteOperations(defaultDraft, [operation], { templateIds, lastChange: "No-op" });
  assert.equal(result.changed, false);
  assert.equal(result.draft.revision, defaultDraft.revision);
  assert.deepEqual(result.appliedTargets, []);
});

test("replaces imported products as one reversible draft change", () => {
  const products = [{
    sku: "NEW-001",
    name: { zh: "测试产品", en: "Test Product" },
    summary: { zh: "测试简介", en: "Test description" },
    category: "测试",
    status: "draft" as const,
    imageColor: "#ffffff",
  }];
  const result = applySiteOperations(defaultDraft, [{ op: "replace_products", products }], { templateIds, lastChange: "Imported" });
  assert.equal(result.draft.products.length, 1);
  assert.equal(result.draft.products[0].sku, "NEW-001");
  const restored = applySiteOperations(result.draft, result.inverseOperations, { templateIds, lastChange: "Undo" });
  assert.deepEqual(restored.draft.products, defaultDraft.products);
});
