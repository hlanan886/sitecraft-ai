import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft, type SiteDraft } from "../lib/site-document.ts";
import { mergeChatTaskResults } from "../lib/chat-task-executor.ts";
import type { SiteOperation } from "../lib/site-operations.ts";

const ok = (operations: SiteOperation[], summary: string) => ({
  ok: true as const, operations, summary, rejected: [] as string[], model: "test", latencyMs: 1, attemptCount: 1,
});

const draft: SiteDraft = structuredClone(defaultDraft);
const firstId = draft.content.features.items[0].id;

/**
 * 这一族 key 是**同批操作的冲突/去重指纹**（stage 4 收口）。
 * 两条操作若指向同一条目的同一字段却给了不同值，必须被判为冲突——
 * 否则会**静默丢掉一条**，用户少改一处内容。
 */
test("mergeChatTaskResults：同一条目同一字段的不同值必须判为冲突", () => {
  const result = mergeChatTaskResults([
    ok([{ op: "update_item", section: "features", index: 0, itemId: firstId, locale: "zh", title: "甲" }], "任务一"),
    ok([{ op: "update_item", section: "features", index: 0, itemId: firstId, locale: "zh", title: "乙" }], "任务二"),
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "operation_conflict");
});

test("mergeChatTaskResults：不同字段不算冲突，两条都要保留", () => {
  const result = mergeChatTaskResults([
    ok([{ op: "update_item", section: "features", index: 0, itemId: firstId, locale: "zh", title: "甲" }], "任务一"),
    ok([{ op: "update_item", section: "features", index: 0, itemId: firstId, locale: "zh", body: "乙" }], "任务二"),
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.operations.length, 2);
});

/**
 * ⚠️ 这一条是**结构性断言**，不是行为断言。
 *
 * 收口前，`mergeChatTaskResults` 与 `dedupeByTarget` 各自手拼字符串，
 * 而且**已经漂了**（一边 `item.id`、一边 `itemId ?? index`）。漂了不会有测试变红，
 * 只会在真实冲突上漏判 → 静默丢操作。
 *
 * 所以这里直接断言两边**共用同一个构造函数**：把两处实现拆开就会红。
 */
test("冲突判定与去重判定必须共用同一个 key 构造函数", async () => {
  const operations = await import("../lib/site-operations.ts");
  const executorSource = await (await import("node:fs/promises")).readFile(
    new URL("../lib/chat-task-executor.ts", import.meta.url),
    "utf8",
  );

  const probe: SiteOperation = { op: "update_item", section: "features", index: 3, itemId: "probe-id", locale: "zh", title: "x" };
  const keys = operations.operationConflictKeys(probe);
  assert.ok(keys.length > 0, "构造函数必须为 update_item 产出 key");
  assert.deepEqual(keys, ["item:features:probe-id:zh:title"]);

  // 结构性断言：chat 侧**不能再自己拼** `item:` 前缀（那正是收口前漂移的来源）。
  // ⚠️ 先剥掉注释行再判——注释里为了说明来龙去脉会提到 `item:`，
  // 拿它当"在拼键"的证据会得到一个永久为真的假断言。
  const codeOnly = executorSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert.equal(
    /`item:/.test(codeOnly),
    false,
    "chat-task-executor 不得再手拼 item: 键——它必须走 site-operations 的统一构造器",
  );
  assert.match(executorSource, /operationConflictEffects/, "必须引用统一构造器");
});

/**
 * 下面两条断言"**改用 itemId 而不是 index**"（⑥-4b 的取舍）**没有被漂回去**。
 * 下标在条目增删后会指到别人身上，用下标当指纹会让两条针对不同条目的操作
 * 被误判成同一条 → 静默丢一条。
 */
test("key 用 itemId 定位，条目增删后不会错误合并", () => {
  const a: SiteOperation = { op: "update_item", section: "features", index: 0, itemId: "id-a", locale: "zh", title: "x" };
  const b: SiteOperation = { op: "update_item", section: "features", index: 0, itemId: "id-b", locale: "zh", title: "x" };
  const conflict = mergeChatTaskResults([ok([a], "一"), ok([b], "二")]);
  assert.equal(conflict.ok, true, "index 相同但 itemId 不同 = 两条不同操作，不该判冲突");
});
