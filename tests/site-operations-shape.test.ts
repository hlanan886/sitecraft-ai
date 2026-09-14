/**
 * `validateOperationShapes` 的形状校验测试（B3 宽修，T-6 完整解）。
 *
 * ## 为什么独立文件
 *
 * 用户 2026-09-13 裁决 Q5：**新建本文件，不做并列**（`draft-field-limits.test.ts`
 * 管的是长度一族，形状一族独立成篇，边界更清楚）。
 *
 * ## 三组坏样本（先红后绿，军规 2）
 *
 * 1. 未知 op（历史归一化后仍不认识的字符串）——静默穿过 `applySiteOperations`
 *    的 `if` 长链是现状；宽修后必须被拒且给出可读原因。
 * 2. 非法 locale——`update_item` 有窄修守卫（跳过+报告一次），但其它 op 没有；
 *    且**新提交**路径不应把坏 locale 放进系统，宽修在入口拦掉。
 * 3. 不存在的 section——`add_item`/`update_item` 的 section 未做集合校验，
 *    坏值只会在更深处炸或静默写坏数据。
 *
 * ## 语义（与 `validateGenerationOperations` 对齐）
 *
 * 拒单条 + 可读中文原因，**其余保留**——禁止新增"一条坏操作炸掉整批"的路径。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { applySiteOperations, validateOperationShapes, type SiteOperation } from "../lib/site-operations.ts";
import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import { templates } from "../lib/site-model.ts";

/** 故意造坏形状的捷径：类型层不接受，运行时必须挡住。 */
const asOps = (list: unknown[]) => list as unknown as SiteOperation[];

test("未知 op → 拒单条 + 可读中文原因", () => {
  const { valid, rejected } = validateOperationShapes(asOps([
    { op: "totally_unknown_op", foo: 1 },
    { op: "set_text", target: "hero.title", locale: "zh", value: "保留我" },
  ]));

  assert.equal(rejected.length, 1, "未知 op 必须被拒一次");
  assert.match(rejected[0], /[一-龥]/, "拒绝原因必须是可读中文");
  assert.equal(valid.length, 1, "其余操作必须保留（拒单条保其余）");
  assert.equal((valid[0] as { op: string }).op, "set_text");
});

test("非法 locale → 拒单条 + 可读中文原因", () => {
  const { valid, rejected } = validateOperationShapes(asOps([
    { op: "update_item", section: "features", locale: "fr", index: 0, title: "Bonjour" },
    { op: "update_item", section: "features", locale: "zh", index: 0, title: "你好" },
  ]));

  assert.equal(rejected.length, 1, "坏 locale 必须被拒一次");
  assert.match(rejected[0], /[一-龥]/);
  assert.match(rejected[0], /fr/, "原因里要点出是哪个值坏了");
  assert.equal(valid.length, 1, "合法 locale 的那条必须保留");
});

test("不存在的 section → 拒单条 + 可读中文原因", () => {
  const { valid, rejected } = validateOperationShapes(asOps([
    { op: "add_item", section: "pricing", item: { id: "x", title: { zh: "", en: "" }, body: { zh: "", en: "" } } },
    { op: "add_item", section: "features", item: { id: "y", title: { zh: "", en: "" }, body: { zh: "", en: "" } } },
  ]));

  assert.equal(rejected.length, 1, "坏 section 必须被拒一次");
  assert.match(rejected[0], /[一-龥]/);
  assert.match(rejected[0], /pricing/, "原因里要点出是哪个 section 坏了");
  assert.equal(valid.length, 1, "合法 section 的那条必须保留");
});

/* ------------------------------------------------------------------ *
 * 负向验证（军规 2）：证明"现状确实会静默接受"——不是假想
 * ------------------------------------------------------------------ */

/**
 * 2026-09-13 宽修**前**的实测原文（当时的取证脚本输出，现已固化为断言）：
 *
 * ```
 * NEG-PROOF {"changed":true,"appliedTargets":["pricing.items.0"],"draftHasPricing":true}
 * ```
 *
 * → 三个坏形状（未知 op / 坏 locale / 坏 section）零拒绝，且坏 section
 * `pricing` **真的被写进了草稿**（`draftHasPricing: true`）。
 */
test("兜底断言：未知 op 直调 applySiteOperations 必须抛（宽修后不得静默穿过）", () => {
  assert.throws(
    () => applySiteOperations(
      cloneDraft(defaultDraft),
      [{ op: "totally_unknown_op", foo: 1 }] as never,
      { templateIds: new Set(templates.map((t) => t.id)), lastChange: "B3 负向验证" },
    ),
    /未知操作/,
    "未知 op 会静默穿过整条 if 长链——这正是宽修要堵的形态",
  );
});
