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
