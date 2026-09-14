import assert from "node:assert/strict";
import test from "node:test";
import { currentOperationName, LEGACY_OPERATION_NAMES } from "../lib/legacy-op-names.ts";

/**
 * 别名表是**追加式**（append-only）的——用户裁决 ①a（2026-09-12）。
 *
 * ## 为什么需要这条快照测试
 *
 * 别名表只在"存量旧名渐渐淘汰"之后才该收缩。**删掉一条 = 那批旧数据再也读不进来**，
 * 而且是**静默**的：读取不会报错，只会让那些 op 落到
 * `operation.op === "update_item"` 之类的判断之外，**静默无操作**。
 * 用户看到的是"undo 点了没反应"，不是任何一条错误信息。
 *
 * 本仓库已经因为**同一族字符串被顺手改掉**吃过一次亏：
 * 2026-09-12 的改名用盲替换（`sed` 全线替换旧名）时，把这张表和两个调研脚本的
 * `LEGACY_OPS` 一起换成了新名，于是"旧名 → 新名"变成"新名 → 新名"——
 * **兼容层静默变成空操作，而测试全绿**（因为新名本来就能读）。
 *
 * 所以这里用**内联快照**把它钉死：增条目要显式改快照（有意识的动作），
 * 删条目或改值会让测试立刻红。
 */

/** 快照：`旧名 → 新名`。**只增不改**——要删请先确认那批数据已不存在。 */
const ALIAS_SNAPSHOT: Readonly<Record<string, string>> = {
  update_card: "update_item",
  add_card: "add_item",
  remove_card: "remove_item",
};

test("别名表快照：内容与快照逐条一致（改值/删条目都会红）", () => {
  assert.deepEqual(
    { ...LEGACY_OPERATION_NAMES },
    { ...ALIAS_SNAPSHOT },
    "别名表变了。新增是有意的（改快照即可）；**删改请先确认那批旧数据确实不再需要读取**。",
  );
});

test("别名表追加式：快照里的每一条都仍在，且值没被改过", () => {
  for (const [legacy, current] of Object.entries(ALIAS_SNAPSHOT)) {
    assert.equal(
      LEGACY_OPERATION_NAMES[legacy],
      current,
      `旧名 ${legacy} 的映射被删除或改动了——那批历史数据会静默读不出来`,
    );
  }
});

test("别名表只做映射，不改行为：不是旧名的原样返回", () => {
  assert.equal(currentOperationName("update_item"), "update_item", "新名不该被二次映射");
  assert.equal(currentOperationName("set_text"), "set_text");
  assert.equal(currentOperationName("nonsense_op"), "nonsense_op", "不认识的 op 必须原样放行，不能吞掉");
  assert.equal(currentOperationName(undefined), undefined);
  assert.equal(currentOperationName(null), null);
  assert.equal(currentOperationName(42), 42);
});
