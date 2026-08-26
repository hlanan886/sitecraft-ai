import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import {
  applySiteOperations,
  describeDestructive,
  isDestructiveOperation,
  validateAIOperations,
  type AIOperation,
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

test("rejects english operations when user says 别动英文", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const validated = validateAIOperations("别动英文，把中文首屏改好", ops, templateIds);
  assert.equal(validated.operations.length, 1);
  const [zhOp] = validated.operations;
  assert.ok(zhOp.op === "set_text");
  assert.equal(zhOp.locale, "zh");
  assert.match(validated.rejected[0], /英文/);
});

test("allows only zh operations when user says 只改中文", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const validated = validateAIOperations("只改中文，别动英文", ops, templateIds);
  assert.equal(validated.operations.length, 1);
  const [zhOp2] = validated.operations;
  assert.ok(zhOp2.op === "set_text");
  assert.equal(zhOp2.locale, "zh");
});

test("does not over-restrict on bilingual or normal instructions", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const both = validateAIOperations("中英文都改一下首屏", ops, templateIds);
  assert.equal(both.operations.length, 2);
  const normal = validateAIOperations("把首屏标题改一下", ops, templateIds);
  assert.equal(normal.operations.length, 2);
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

test("detects destructive operations that need confirmation", () => {
  const removeCard: SiteOperation = { op: "remove_card", section: "features", itemId: "quality" };
  const hideSection: SiteOperation = { op: "set_section_visibility", section: "about", visible: false };
  const showSection: SiteOperation = { op: "set_section_visibility", section: "about", visible: true };
  const switchTemplate: SiteOperation = { op: "set_template", templateId: "kindred" };
  const reorder: SiteOperation = { op: "reorder_sections", order: ["about", "features", "services", "products", "contact"] };
  const editText: SiteOperation = { op: "set_text", target: "hero.title", locale: "zh", value: "x" };

  assert.equal(isDestructiveOperation(removeCard), true);
  assert.equal(isDestructiveOperation(hideSection), true);
  assert.equal(isDestructiveOperation(showSection), false); // 显示区块不破坏
  assert.equal(isDestructiveOperation(switchTemplate), true);
  assert.equal(isDestructiveOperation(reorder), true);
  assert.equal(isDestructiveOperation(editText), false);

  assert.match(describeDestructive(removeCard), /删除/);
  assert.match(describeDestructive(hideSection), /隐藏/);
  assert.match(describeDestructive(switchTemplate), /切换模板/);

  // 精确字符串断言：删除和卡片之间不得有多余空格（Codex 验收反馈 D1）
  assert.equal(describeDestructive(removeCard), "删除核心优势卡片「quality」");
  const removeService: SiteOperation = { op: "remove_card", section: "services", itemId: "delivery" };
  assert.equal(describeDestructive(removeService), "删除服务卡片「delivery」");
});
