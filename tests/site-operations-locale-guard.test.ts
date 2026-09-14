import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import { applySiteOperations, aiOperationSchema } from "../lib/site-operations.ts";

const templateIds = new Set(["forge", "kindred", "signal"]);

/**
 * T-6 **窄修**：`update_item` 的 `locale` 守卫（2026-09-12）。
 *
 * ## 缺陷是什么
 *
 * `applySiteOperations` 的 `update_item` 分支直接写 `item.title[operation.locale] = ...`。
 * **JS 把 `undefined` 转成字符串 `"undefined"` 当键**，于是草稿的 `title`/`body`
 * 里多出一个 `undefined` 键，且 `changed = true`——**改坏了数据还不报错**。
 *
 * ## 为什么它是"活的"，不是假想
 *
 * PG 里有 8 条 `update_card` **缺 `locale`** 的历史（2026-09-12 实测）。
 * 本轮改名 + 读取归一化把旧名 `update_card` 映射成 `update_item`——
 * **正好落进这条分支**。也就是说：
 * 不改名它走不进来（判别式不匹配），**改名把它激活了**。
 *
 * ## 这个测试为什么必须用**新名**构造样本
 *
 * 第一版用的是旧名 `update_card`，结果 `applySiteOperations` 的
 * `operation.op === "update_item"` 判断不吃它 → 整条操作被静默忽略 → **测试假绿**。
 * 真正的活路径是**新名 + 缺 locale**。
 */

const corrupt = { op: "update_item", section: "features", index: 0, title: "新标题" } as never;

test("守卫：缺 locale 的 update_item 不得往草稿里写 \"undefined\" 键", () => {
  const draft = structuredClone(defaultDraft);
  const before = structuredClone(draft.content.features.items[0].title);
  const result = applySiteOperations(draft, [corrupt], { templateIds, lastChange: "T-6" });

  const item = result.draft.content.features.items[0];
  assert.equal(
    Object.hasOwn(item.title, "undefined"),
    false,
    `草稿被污染：title keys = ${Object.keys(item.title).join(",")}`,
  );
  assert.deepEqual(item.title, before, "跳过 = 原样不动，不猜语言也不改错语言");
  assert.equal(result.changed, false, "整批因此没有产生任何变更");
});

test("守卫不误伤：带合法 locale 的同形操作照常生效", () => {
  const draft = structuredClone(defaultDraft);
  const healthy = { op: "update_item", section: "features", index: 0, locale: "zh", title: "正规标题" } as never;
  const result = applySiteOperations(draft, [healthy], { templateIds, lastChange: "T-6 对照" });
  assert.equal(result.changed, true, "合法操作不能被守卫拦掉");
  assert.equal(result.draft.content.features.items[0].title.zh, "正规标题");
  assert.equal(result.draft.content.features.items[0].title.en, defaultDraft.content.features.items[0].title.en);
});

test("守卫不猜语言：缺 locale 时不写入 zh 也不写入 en", () => {
  const draft = structuredClone(defaultDraft);
  const result = applySiteOperations(draft, [corrupt], { templateIds, lastChange: "T-6" });
  const item = result.draft.content.features.items[0];
  assert.notEqual(item.title.zh, "新标题", "猜 zh 会改错语言——本守卫明确不做这件事");
  assert.notEqual(item.title.en, "新标题");
});

/**
 * 与 schema 的一致性：这条形态**过不了 schema**（`locale` 必填），
 * 而 `applySiteOperations` 不做 schema 校验（T-6 宽修的由来）。
 * 窄修不动这个事实——它只是在**已知会坏的那一处**加守卫。
 */
test("已知边界：这条形态过不了 aiOperationSchema（宽修仍待做）", () => {
  assert.equal(aiOperationSchema.safeParse(corrupt).success, false);
});
