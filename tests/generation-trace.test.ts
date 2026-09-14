import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSectionAwareness,
  isGenerationTraceEnabled,
  reconcileSectionUnderstanding,
  shortFingerprint,
} from "../lib/generation-trace.ts";

// ===== env 解析 =====

test("isGenerationTraceEnabled: 仅 SITECRAFT_LOG_GENERATION=1 时为真", () => {
  const original = process.env.SITECRAFT_LOG_GENERATION;
  try {
    delete process.env.SITECRAFT_LOG_GENERATION;
    assert.equal(isGenerationTraceEnabled(), false);
    process.env.SITECRAFT_LOG_GENERATION = "0";
    assert.equal(isGenerationTraceEnabled(), false);
    process.env.SITECRAFT_LOG_GENERATION = "true";
    assert.equal(isGenerationTraceEnabled(), false, "只认 '1'，避免误开");
    process.env.SITECRAFT_LOG_GENERATION = "1";
    assert.equal(isGenerationTraceEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.SITECRAFT_LOG_GENERATION;
    else process.env.SITECRAFT_LOG_GENERATION = original;
  }
});

// ===== awareness 提取（lenient） =====

test("extractSectionAwareness: 正常字段被解析", () => {
  const raw = JSON.stringify({
    summary: "x",
    operations: [],
    templateAwareness: [
      { section: "features", nativeRole: "icon_row", plannedItems: 4, fallbackDeclared: false, reason: "" },
      { section: "services", nativeRole: "icon_row", plannedItems: 3, fallbackDeclared: true, reason: "原生位不足" },
    ],
  });
  const parsed = extractSectionAwareness(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].section, "features");
  assert.equal(parsed[0].nativeRole, "icon_row");
  assert.equal(parsed[0].plannedItems, 4);
  assert.equal(parsed[1].fallbackDeclared, true);
});

test("extractSectionAwareness: 缺字段/畸形一律降级为空，不抛错", () => {
  assert.deepEqual(extractSectionAwareness(undefined), []);
  assert.deepEqual(extractSectionAwareness("not json"), []);
  assert.deepEqual(extractSectionAwareness(JSON.stringify({ operations: [] })), []);
  assert.deepEqual(extractSectionAwareness(JSON.stringify({ templateAwareness: "oops" })), []);
  // 无 section 的条目被丢弃
  const parsed = extractSectionAwareness(JSON.stringify({ templateAwareness: [{ nativeRole: "x" }, { section: "about" }] }));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].section, "about");
});

// ===== 逐节对账（红队修正后的硬指标） =====

const presentation = [
  { presentationSlot: "features", role: "icon_row", capacityMax: 6 },
  { presentationSlot: "services", role: "icon_row", capacityMax: 4 },
  { presentationSlot: "about", role: "split_text_media", capacityMax: 1 },
];

test("reconcile: 声明 + 操作贴合容量 → declared_ok", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["features"],
    ops: [
      { op: "set_text", target: "features.title", locale: "zh", value: "x" },
      { op: "update_item", section: "features", index: 0, locale: "zh", title: "a" },
      { op: "update_item", section: "features", index: 1, locale: "zh", title: "b" },
    ],
    presentation,
    declarations: [{ section: "features", nativeRole: "icon_row", plannedItems: 2, fallbackDeclared: false }],
  });
  assert.equal(report.length, 1);
  assert.equal(report[0].verdict, "declared_ok");
  assert.equal(report[0].roleMatch, true);
  assert.equal(report[0].withinCapacity, true);
});

test("reconcile: 卡片数超出模板容量 → overflow（硬指标，即使 role 抄对）", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["services"],
    ops: Array.from({ length: 6 }, (_, i) => ({ op: "update_item", section: "services", index: i, locale: "zh", title: `t${i}` })),
    presentation,
    declarations: [{ section: "services", nativeRole: "icon_row", plannedItems: 6, fallbackDeclared: false }],
  });
  assert.equal(report[0].verdict, "overflow");
  assert.equal(report[0].withinCapacity, false);
  assert.equal(report[0].itemCountEstimate, 6);
  assert.equal(report[0].capacityMax, 4);
});

test("reconcile: 有操作但无声明 → no_declaration", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["about"],
    ops: [{ op: "set_text", target: "about.body", locale: "zh", value: "x" }],
    presentation,
  });
  assert.equal(report[0].verdict, "no_declaration");
});

test("reconcile: 无操作 → no_ops（hidden 节直接跳过）", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["about", "features"],
    ops: [],
    presentation,
    hiddenSections: ["features"],
  });
  assert.equal(report.length, 1, "hidden 的 features 不参与对账");
  assert.equal(report[0].section, "about");
  assert.equal(report[0].verdict, "no_ops");
});

test("reconcile: 本地快速初稿 → local_fallback（无模型声明可对）", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["features"],
    ops: [{ op: "set_text", target: "features.title", locale: "zh", value: "x" }],
    presentation,
    localFallback: true,
  });
  assert.equal(report[0].verdict, "local_fallback");
});

test("reconcile: role 抄写不一致 → role_mismatch（软信号，不因容量问题覆盖）", () => {
  const report = reconcileSectionUnderstanding({
    sections: ["features"],
    ops: [{ op: "update_item", section: "features", index: 0, locale: "zh", title: "a" }],
    presentation,
    declarations: [{ section: "features", nativeRole: "card_grid", plannedItems: 1, fallbackDeclared: false }],
  });
  assert.equal(report[0].verdict, "role_mismatch");
  assert.equal(report[0].roleMatch, false);
});

// ===== 指纹 =====

test("shortFingerprint: 稳定且脱敏（不返回原文）", () => {
  const a = shortFingerprint("敏感文本");
  const b = shortFingerprint("敏感文本");
  assert.equal(a, b);
  assert.equal(a.length, 12);
  assert.notEqual(a, "敏感文本");
});
