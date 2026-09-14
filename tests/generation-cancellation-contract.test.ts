import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("generate page aborts analyze requests and releases both SSE readers", async () => {
  const source = await readFile(new URL("../app/generate/page.tsx", import.meta.url), "utf8");
  assert.match(source, /analyzeControllerRef/);
  const analyzeBlock = source.slice(source.indexOf("const analyze = async"), source.indexOf("const toggleSection"));
  assert.match(analyzeBlock, /signal:\s*controller\.signal/);
  const executeBlock = source.slice(source.indexOf("const execute = async"), source.indexOf("useEffect", source.indexOf("const execute = async")));
  assert.match(executeBlock, /controller\.abort\(\);\s*void reader\?\.cancel\(\)/);

  /**
   * B5（2026-09-13）：reader 的释放**所有权从页面移到了 `lib/sse-events`**。
   *
   * 原断言是 `assert.match(analyzeBlock, /reader\?\.releaseLock\(\)/)` —— 它检查的是
   * **"页面里写着这行代码"**，即机制的实现位置。换实现后它必然红，
   * 但那条保证（reader 一定被释放）**并没有丢**——只是搬了家。
   *
   * 所以断言的落点从"谁写这行"改成"保证是否成立"，分两半：
   *  ① 页面**不得**再自行释放（否则是二次调用：`releaseLock` 抛 TypeError 被吞，
   *     看着无害，但把"谁负责释放"变成两处，将来必漂）；
   *  ② 三个消费点都必须走 `readSseEvents`——释放由它的 `finally` 兜住，
   *     且它对每个 reader **恰好释放一次**（对应用户红线里的"每个恰好一次"）。
   *
   * ⚠️ 这是**结构性断言**（读源码文本），不是行为断言。它证明不了"运行时真的释放了"——
   * 那件事由 `tests/sse-events.test.ts` 的 `state.releases === 1` 以行为方式锁住。
   * 两者互补：这里防"页面又长出一份自己的释放逻辑"，那里防"lib 的 finally 被删掉"。
   */
  assert.doesNotMatch(
    analyzeBlock,
    /try \{ reader\?\.releaseLock\(\)/,
    "页面不得再自行释放 reader——所有权已归 readSseEvents 的 finally；" +
      "如需恢复页面侧释放，请连同 lib 的 finally 一并裁决（否则是二次释放）",
  );
  assert.doesNotMatch(executeBlock, /try \{ reader\?\.releaseLock\(\)/, "同上（execute）");

  const consumers = source.match(/await readSseEvents\(reader,/g) ?? [];
  assert.equal(
    consumers.length,
    3,
    `三个 SSE 消费点（analyze / execute / recoverMissingSections）都必须走 readSseEvents，` +
      `实得 ${consumers.length} 处——少一处就意味着那个 reader 没人释放`,
  );
});

test("route propagates analyze and regenerate deadlines and commit signal", async () => {
  const source = await readFile(new URL("../app/api/sites/[siteId]/generate/route.ts", import.meta.url), "utf8");
  const analyzeCall = source.slice(source.indexOf("requestSiteIntent({"), source.indexOf("if (!intentRes.ok)"));
  assert.match(analyzeCall, /signal:/);
  assert.match(analyzeCall, /deadlineAt:/);
  const regenerateCall = source.slice(source.indexOf("regenerateSectionOperations({"), source.indexOf(": await generateDraftOperations"));
  assert.match(regenerateCall, /signal:\s*generationSignal/);
  assert.match(regenerateCall, /deadlineAt/);
  const commitCall = source.slice(source.indexOf("commitOperations({", source.indexOf("正在校验内容并保存")), source.indexOf("});", source.indexOf("commitOperations({", source.indexOf("正在校验内容并保存"))));
  // 2026-09-10：写入路径改为只透传**客户端取消**信号（`clientAbortSignal`），
  // 而不再透传 `generationSignal`——后者含 deadline 超时，会让已生成好的内容被一并丢弃。
  // 「取消即中止写入」的保证不变（写入边界仍有 abort 检查）。
  assert.match(commitCall, /signal:\s*clientAbortSignal/);
  assert.doesNotMatch(commitCall, /signal:\s*generationSignal/);
});

/**
 * 2026-09-10 回归：deadline 超时不得丢弃已生成内容。
 *
 * 背景：`generated.ok === true` 说明内容已生成，但此前紧接着的
 * `if (generationSignal.aborted) { …return }` 会因 deadline 超时整份丢弃，
 * 与 `generation-budget.ts:108` 承诺的「已完成的内容会保留」直接矛盾。
 * 唯一正当的放弃理由是**客户端主动取消**。
 */
test("route keeps generated content when only the deadline fired (vs client cancel)", async () => {
  const source = await readFile(new URL("../app/api/sites/[siteId]/generate/route.ts", import.meta.url), "utf8");

  // 必须区分两种 abort：客户端取消才提前返回
  assert.match(source, /const clientAbortSignal = AbortSignal\.any\(\[request\.signal,\s*responseCancelled\.signal\]\)/);
  assert.match(source, /if \(clientAbortSignal\.aborted\)/);
  // 不得再对「含 deadline 的 generationSignal」做丢弃式提前返回
  assert.doesNotMatch(source, /if \(generationSignal\.aborted\)\s*\{\s*recordTerminal/);
});

test("storage checks abort at the local rename and database COMMIT boundaries", async () => {
  const store = await readFile(new URL("../lib/site-store.ts", import.meta.url), "utf8");
  assert.match(store, /signal\?:\s*AbortSignal/);
  assert.match(store, /throwIfAborted\(signal\);[\s\S]*?await rename\(temp, target\)/);
  assert.match(store, /withDatabaseTransaction\([\s\S]*args\.signal\)/);
  const postgres = await readFile(new URL("../lib/postgres.ts", import.meta.url), "utf8");
  assert.match(postgres, /throwIfAborted\(signal\);[\s\S]*?await client\.query\("COMMIT"\)/);
});
