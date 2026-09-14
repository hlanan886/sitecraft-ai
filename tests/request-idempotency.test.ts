import assert from "node:assert/strict";
import test from "node:test";
import { hashRequestPayload, RequestIdempotencyStore } from "../lib/request-idempotency.ts";

test("request idempotency returns in-flight for duplicate work and replays completed result", () => {
  const store = new RequestIdempotencyStore({ ttlMs: 10_000 });
  assert.deepEqual(store.begin("chat:site-1", "key-1"), { status: "new" });
  assert.deepEqual(store.begin("chat:site-1", "key-1"), { status: "inflight" });

  const done = { type: "done", status: "applied", revision: 2 };
  store.complete("chat:site-1", "key-1", done);
  assert.deepEqual(store.begin("chat:site-1", "key-1"), { status: "completed", result: done });
  assert.deepEqual(store.begin("chat:site-2", "key-1"), { status: "new" });
});

test("request idempotency expires stale entries", () => {
  let now = 1_000;
  const store = new RequestIdempotencyStore({ ttlMs: 100, now: () => now });
  assert.deepEqual(store.begin("generate:site-1", "key-1"), { status: "new" });
  now += 101;
  assert.deepEqual(store.begin("generate:site-1", "key-1"), { status: "new" });
});

test("request idempotency releases a reservation when the request exits before a terminal event", () => {
  const store = new RequestIdempotencyStore({ ttlMs: 10_000 });
  assert.deepEqual(store.begin("chat:site-1", "key-early-exit"), { status: "new" });
  store.release("chat:site-1", "key-early-exit");
  assert.deepEqual(store.begin("chat:site-1", "key-early-exit"), { status: "new" });
});

test("request idempotency rejects reusing a key for a different payload", () => {
  const store = new RequestIdempotencyStore({ ttlMs: 10_000 });
  assert.deepEqual(store.begin("chat:site-1", "key-reused", "hash-a"), { status: "new" });
  assert.deepEqual(store.begin("chat:site-1", "key-reused", "hash-b"), { status: "key_conflict" });
  assert.deepEqual(store.begin("chat:site-1", "key-reused", "hash-a"), { status: "inflight" });
});

test("request payload hash is stable when JSON object keys are reordered", () => {
  assert.equal(
    hashRequestPayload({ message: "更新首屏", intent: { companyName: "华辰", industry: "制造" } }),
    hashRequestPayload({ intent: { industry: "制造", companyName: "华辰" }, message: "更新首屏" }),
  );
});
