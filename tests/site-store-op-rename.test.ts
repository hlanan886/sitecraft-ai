import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LEGACY_OPERATION_NAMES } from "../lib/legacy-op-names.ts";

/**
 * 阶段 4 · 往返验收：**旧名读入 → undo 重放 → 新名落盘 → 再读**（文件后端）。
 *
 * 这条链路的每一段都可能单独"看起来对"却整体是坏的：
 * 只测"旧名能被读出来"不够——还要证明**读出来的东西真的能重放**，
 * 且**重放产生的新历史用新名落盘、再读还能重放**。
 * 用户裁决第 3 条要求文件 / PG 各一个样本，本文件是文件后端那一份。
 *
 * ## ⚠️ 本文件为什么**一个 site-store 的静态 import 都不能有**
 *
 * `site-store` 的 `storageRoot` **在模块加载时固化**。要让它在加载时取到临时目录，
 * 就必须**在它被加载之前**设好 `SITECRAFT_DATA_ROOT`。
 *
 * ESM 的静态 import 会在**模块体求值之前**全部先跑完，所以"顶层设环境变量 +
 * 顶层静态 import site-store"是**错的顺序**——它会先加载 site-store（固化真实路径），
 * 再设环境变量（已经晚了）。本测试前两版都栽在这里，症状是读写落到真实的
 * `.sitecraft-data/sites` 上。
 *
 * 所以：site-store 一律**动态 import**，且只在环境变量设好之后调用。
 *
 * 默认值本身不靠这个时序保证，而由**纯函数** `resolveStorageRoot` 断言——
 * 纯函数不依赖加载时机，测的是规则本身。
 */
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sitecraft-store-"));
const originalDataRoot = process.env.SITECRAFT_DATA_ROOT;
process.env.SITECRAFT_DATA_ROOT = tempRoot;

/** 环境变量到位之后才加载 site-store。 */
const loadStore = () => import("../lib/site-store.ts");

test.after(async () => {
  if (originalDataRoot === undefined) delete process.env.SITECRAFT_DATA_ROOT;
  else process.env.SITECRAFT_DATA_ROOT = originalDataRoot;
  await rm(tempRoot, { recursive: true, force: true });
});

const SITE_ID = "roundtrip-site";
const SAMPLE_TITLE = "改后的标题";
const recordFile = path.join(tempRoot, "sites", `${SITE_ID}.json`);

/**
 * 造出"改名之前落盘的历史"：先走真实接口写一批新名操作，
 * 再把盘上那条 ChangeSet 的操作名**改回旧名**。
 *
 * 为什么不直接手写整个 JSON：那样测的是我手写的格式，而不是**真实存储格式**——
 * 存储格式一旦变了，手写的样本会继续"绿"（附则 3：假门禁的典型形态）。
 */
async function ageLastChangeSetToLegacy() {
  const onDisk = JSON.parse(await readFile(recordFile, "utf8"));
  const newest = onDisk.history.at(-1);
  // ⚠️ 这里**不能**断言"别名表里有 update_card"。
  // 加了那条断言的话，别名表一旦被打空，本用例会**红在样本构造处**，
  // 看着"门禁生效"，其实根本没走到重放——**那是假门禁**。
  // 别名表有没有那条映射，由下面第 ③ 步的归一化结果来判：
  // 没映射 → 旧名读回来还是旧名 → 重放静默无操作 → 用例红在正确的位置。
  const ops = [...newest.operations, ...newest.inverseOperations];
  assert.ok(ops.length > 0, "样本必须真的含操作，否则这个测试什么都没测");
  for (const op of ops) op.op = "update_card";
  await writeFile(recordFile, JSON.stringify(onDisk, null, 2), "utf8");
  return ops.length;
}

test("默认行为：不设 SITECRAFT_DATA_ROOT 时，存储根与改动前逐字节一致", async () => {
  const { resolveStorageRoot } = await loadStore();
  const cwd = "D:\\sitecraft-ai";
  // 改动前的表达式，逐字复算一遍。
  assert.equal(
    resolveStorageRoot({}, cwd),
    path.join(cwd, ".sitecraft-data", "sites"),
  );
  // 设了才走覆盖分支；覆盖时**只多一层 sites**，其余不变。
  assert.equal(
    resolveStorageRoot({ SITECRAFT_DATA_ROOT: path.join(cwd, "tmp") }, cwd),
    path.join(cwd, "tmp", "sites"),
  );
});

test("文件后端往返：旧名读入 → undo 重放 → 新名落盘 → 再读", async () => {
  const { commitOperations, getSite, moveHistory } = await loadStore();

  // ---- ① 造站点，并把落盘现场清成"空历史" ----
  // ⚠️ 两个反直觉之处，都实测过：
  //  a) `getSite` 返回的 history 是**最近 30 条**的投影（snapshot 里 slice(-30)），
  //     不是盘上真实历史，不能拿它当"新站点"的判据；
  //  b) **`getSite` 会顺手写下一条初始 ChangeSet**（`createRecord` 造出的记录
  //     带 `lastChange`，落盘即成为一条"AI 保存"变更）。
  // 所以这里显式把盘上现场清空，让后续每一步的因果都清楚。
  await getSite(SITE_ID);
  const empty = JSON.parse(await readFile(recordFile, "utf8"));
  empty.history = [];
  empty.future = [];
  await writeFile(recordFile, JSON.stringify(empty, null, 2), "utf8");
  const created = await getSite(SITE_ID);
  assert.equal(created.canUndo, false, "前置：清空后没有可撤销的变更");

  // ---- ② 落一批操作，再把盘上那条历史改成旧名 ----
  const first = await commitOperations({
    siteId: SITE_ID,
    baseRevision: created.draft.revision,
    operations: [{ op: "update_item", section: "features", index: 0, locale: "zh", title: SAMPLE_TITLE }],
    summary: "一次改动",
    source: "ai",
  });
  assert.equal(first.status, "applied");
  assert.equal(
    (await getSite(SITE_ID)).draft.content.features.items[0].title.zh,
    SAMPLE_TITLE,
    "前置：这一步必须真的改了标题",
  );
  const agedOps = await ageLastChangeSetToLegacy();
  assert.ok(agedOps >= 2, `样本至少要含正向与逆向各一条，实得 ${agedOps}`);

  // ---- ③ 读回来：旧名应当已被归一成新名 ----
  const reread = await getSite(SITE_ID);
  assert.equal(reread.canUndo, true, "含旧名历史的站点必须仍可 undo");

  // ---- ④ undo 重放（这一段是重点）----
  // 归一化若没接上，inverseOperations 里的旧名会落到
  // `operation.op === "update_item"` 判断之外 → **静默什么都不做**，
  // undo 看着"成功"却没有效果。所以断言必须看**草稿真的变了**。
  const undone = await moveHistory(SITE_ID, "undo");
  assert.equal(undone.status, "applied", "旧名历史必须能重放");
  assert.notEqual(
    undone.record.draft.content.features.items[0].title.zh,
    SAMPLE_TITLE,
    "undo 必须真的把标题改回去，而不是静默无操作",
  );

  // ---- ⑤ 新名落盘 ----
  const second = await commitOperations({
    siteId: SITE_ID,
    baseRevision: undone.record.draft.revision,
    operations: [{ op: "update_item", section: "features", index: 0, locale: "zh", title: "第二次改" }],
    summary: "第二次改动",
    source: "ai",
  });
  assert.equal(second.status, "applied");

  const after = JSON.parse(await readFile(recordFile, "utf8"));
  const newest = after.history.at(-1);
  for (const op of [...newest.operations, ...newest.inverseOperations]) {
    assert.equal(op.op, "update_item", "写入路径只写新名");
  }
  /**
   * 旧的那条历史**也变成了新名**——这是实测结果，不是设计意图，需要说明。
   *
   * 原因：`commitOperations` 读到的是**归一化之后**的 record，
   * 落盘时把整份 history 一起写了回去。也就是说：
   * **归一化间接产生了一次"读取时改写落盘"**——凡是发生过一次写入的站点，
   * 它整段历史的旧名都会被顺手改成新名。
   *
   * 这与方案里的说法（"写入不回写历史、旧名会永远留着"）**不一致**，
   * 属于设计决定，已上报裁决；本断言先锁住**当前真实行为**，
   * 待裁决后要么保留（顺带迁移，兼容期更快结束），
   * 要么改成"只归一化内存副本、落盘保持原样"。
   */
  assert.equal(
    after.history[0].operations[0].op,
    "update_item",
    "当前行为：一次写入会把整段历史一并归一（待裁决）",
  );
  // 但**归一化本身是可重复的**：再读一遍结果不变，不产生新旧名混读的中间态。
  const rereadAfterWrite = await getSite(SITE_ID);
  assert.equal(rereadAfterWrite.canUndo, true, "整段归一后仍可 undo");

  // ---- ⑥ 再读：新旧名混在同一份历史里，都读得懂 ----
  const final = await getSite(SITE_ID);
  assert.equal(final.draft.content.features.items[0].title.zh, "第二次改");
  assert.equal(final.canUndo, true);
});
