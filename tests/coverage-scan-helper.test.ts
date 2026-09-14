import assert from "node:assert/strict";
import test from "node:test";

import { classifyCoverage, requiredTargetsFor, type BridgeReport } from "../e2e/helpers/coverage-scan.ts";
import { getTemplateManifest } from "../lib/template-manifest.ts";

/**
 * coverage-scan 辅助函数单测（2026-09-09 泛化）：
 * requiredTargets 此前是硬编码列表，现从 manifest 派生。这里锁定派生正确性——
 * 该 helper 的 spec 被 playwright testIgnore 排除，无法用 e2e 覆盖，故用单测兜底。
 */

test("requiredTargetsFor 从 manifest 派生且与 slot.required 一致", () => {
  const manifest = getTemplateManifest("forge")!;
  const expected = manifest.slots.filter((slot) => slot.required).map((slot) => slot.target);
  assert.deepEqual([...requiredTargetsFor("forge")], expected);
  assert.ok(expected.length > 0, "forge 应有 required 槽位");
});

test("requiredTargetsFor 对未注册模板返回空数组（不抛错）", () => {
  assert.deepEqual([...requiredTargetsFor("no-such-template")], []);
});

test("classifyCoverage 按 manifest required 判定 missing", () => {
  const manifest = getTemplateManifest("forge")!;
  const required = manifest.slots.filter((slot) => slot.required).map((slot) => slot.target);
  const report = {
    type: "sitecraft:applied",
    revision: 1,
    appliedSlots: [],
    visibleSlots: [],
    // 只覆盖前两个 required，其余应进 missing
    visibleTextsBySlot: Object.fromEntries(required.slice(0, 2).map((target) => [target, ["内容"]])),
    residualDemoSlots: [],
    missingSlots: [],
  } as BridgeReport;

  const result = classifyCoverage("forge", report);
  assert.deepEqual(result.covered, required.slice(0, 2));
  assert.deepEqual(result.missing, required.slice(2));
});
