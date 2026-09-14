import assert from "node:assert/strict";
import test from "node:test";

import { EventDeduper, readSseEvents, type SseEnvelope } from "../lib/sse-events.ts";

function createReader(chunks: Uint8Array[]) {
  let index = 0;
  const state = { reads: 0, cancels: 0, releases: 0 };
  return {
    state,
    reader: {
      async read() {
        state.reads += 1;
        if (index >= chunks.length) return { done: true as const, value: undefined };
        return { done: false as const, value: chunks[index++] };
      },
      async cancel() {
        state.cancels += 1;
      },
      releaseLock() {
        state.releases += 1;
      },
    },
  };
}

test("SSE JSON split across chunks is emitted once without parsing an incomplete frame", async () => {
  const encoder = new TextEncoder();
  const payload = encoder.encode([
    'data: {"type":"status","value":"正在生成"}\n\n',
    'data: {"type":"done","status":"applied"}\n\n',
    'data: {"type":"ignored"}\n\n',
  ].join(""));
  const chineseByte = payload.indexOf(0xe6);
  const doneBoundary = new TextDecoder().decode(payload).indexOf('"done"');
  const doneByte = encoder.encode(new TextDecoder().decode(payload).slice(0, doneBoundary + 3)).byteLength;
  const chunks = [
    payload.slice(0, chineseByte + 1),
    payload.slice(chineseByte + 1, doneByte),
    payload.slice(doneByte, payload.length - 34),
    payload.slice(payload.length - 34),
  ];
  const { reader, state } = createReader(chunks);
  const seen: Record<string, unknown>[] = [];

  const events = await readSseEvents(reader, (event) => seen.push(event));

  assert.deepEqual(events, [
    { type: "status", value: "正在生成" },
    { type: "done", status: "applied" },
  ]);
  assert.deepEqual(seen, events);
  assert.equal(state.cancels, 1);
  assert.equal(state.releases, 1);
  assert.ok(state.reads < chunks.length + 1, "done should stop reading trailing events");
});

test("a stream without done releases its reader and keeps an incomplete tail unparsed", async () => {
  const { reader, state } = createReader([
    new TextEncoder().encode('data: {"type":"status","value":"ready"}\n\ndata: {"type":"sta'),
  ]);

  const events = await readSseEvents(reader);

  assert.deepEqual(events, [{ type: "status", value: "ready" }]);
  assert.equal(state.cancels, 0);
  assert.equal(state.releases, 1);
});

function envelope(sequence: number, revision: number, type = "status"): SseEnvelope {
  return { requestId: "req-1", taskId: "task-1", sequence, revision, type, payload: {} };
}

test("EventDeduper rejects duplicate, out-of-order and stale-revision events, then closes after done", () => {
  const deduper = new EventDeduper();
  assert.equal(deduper.accept(envelope(1, 1)), true);
  assert.equal(deduper.accept(envelope(1, 1)), false);
  assert.equal(deduper.accept(envelope(3, 1)), true);
  assert.equal(deduper.accept(envelope(2, 1)), false);
  assert.equal(deduper.accept(envelope(4, 0)), false);
  assert.equal(deduper.accept(envelope(5, 1, "done")), true);
  assert.equal(deduper.accept(envelope(6, 1)), false);
});

test("readSseEvents deduplicates enveloped events while preserving legacy events", async () => {
  const { reader } = createReader([
    new TextEncoder().encode([
      `data: ${JSON.stringify(envelope(1, 1, "status"))}\n\n`,
      `data: ${JSON.stringify(envelope(1, 1, "status"))}\n\n`,
      `data: ${JSON.stringify(envelope(2, 1, "done"))}\n\n`,
      'data: {"type":"legacy"}\n\n',
    ].join("")),
  ]);
  const events = await readSseEvents(reader);
  assert.equal(events.length, 2);
  assert.equal(events[0].sequence, 1);
  assert.equal(events[1].type, "done");
});

/**
 * 2026-09-13（B5）：`done` 之后的 `reader.cancel()` **不得被 await**。
 *
 * ## 为什么
 *
 * `app/generate/page.tsx` 里有一段付过代价的注释：
 *
 * > 拿到 done 即视为完成。不 await reader.cancel()：该 SSE 流在 Next dev 下
 * > 有时不落 end，await 会永久挂起拖住流程。cancel 交给浏览器/超时兜底。
 *
 * B5 把 generate 页的 SSE 消费换成这个模块后，那条教训必须在这里也成立——
 * 否则就是把一个已经修好的挂起原样搬回来。本用例**用一个永不 resolve 的
 * cancel** 复现那个场景：只要实现里还 `await` 它，本用例就会超时失败。
 */
test("done 之后的 cancel 即使永不 resolve，readSseEvents 也必须立刻返回", async () => {
  let cancelCalled = 0;
  let releases = 0;
  let reads = 0;
  // 用一个已含 done 的 chunk 触发 done 分支
  const withDone = {
    async read() {
      reads += 1;
      return {
        done: false as const,
        value: new TextEncoder().encode('data: {"type":"done","status":"applied"}\n\n'),
      };
    },
    cancel() {
      cancelCalled += 1;
      return new Promise<never>(() => { /* 永不 settle —— 模拟 Next dev 下不落 end 的流 */ });
    },
    releaseLock() { releases += 1; },
  };

  const events = await Promise.race([
    readSseEvents(withDone),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("readSseEvents 被永不 settle 的 cancel 挂住了")), 1_000)),
  ]);

  assert.equal(cancelCalled, 1, "cancel 仍必须被调用（只是不许 await）");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "done");
  // 不阻塞 cancel ≠ 不释放锁：finally 必须照常跑到，否则 reader 永久被占
  assert.equal(releases, 1, "即便 cancel 永不 settle，finally 也必须释放 reader（恰好一次）");
});
