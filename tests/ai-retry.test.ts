import assert from "node:assert/strict";
import test from "node:test";

import { withLimitedRetry } from "../lib/ai-retry.ts";

test("retry policy can raise the bounded attempt count for feedback regeneration", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    if (calls < 3) return { ok: false as const, code: "provider_error" as const, error: "temporary" };
    return { ok: true as const, value: "ready" };
  }, { maxAttempts: 3, backoffMs: 0 });

  assert.equal(calls, 3);
  assert.deepEqual(outcome.result, { ok: true, value: "ready" });
  assert.equal(outcome.attemptCount, 3);
});

test("retry policy never starts another attempt after the shared deadline", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    return { ok: false as const, code: "provider_error" as const, error: "temporary" };
  }, { deadlineAt: Date.now() + 20, backoffMs: 50 });

  assert.equal(calls, 1);
  assert.equal(outcome.attemptCount, 1);
  assert.deepEqual(outcome.result, { ok: false, code: "provider_error", error: "temporary" });
});

test("retry policy lets structured providers opt into schema-feedback retry", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    return calls === 1
      ? { ok: false as const, code: "invalid_output" as const, error: "missing operations" }
      : { ok: true as const, value: "corrected" };
  }, {
    backoffMs: 0,
    shouldRetry: (result) => !result.ok && result.code === "invalid_output",
  });

  assert.equal(calls, 2);
  assert.deepEqual(outcome.result, { ok: true, value: "corrected" });
});

// ===== 恢复被删的超时重试端到端断言（审计发现：仅剩 attempt-count 测试，回归保护缺失）=====

test("timeout on first attempt is retried and succeeds on second", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    if (calls === 1) return { ok: false as const, code: "timeout" as const, error: "DeepSeek 请求超时" };
    return { ok: true as const, value: "success" };
  }, { backoffMs: 0 });
  assert.equal(calls, 2);
  assert.equal(outcome.attemptCount, 2);
  assert.deepEqual(outcome.result, { ok: true, value: "success" });
});

test("both attempts timing out return the timeout failure with attempt count", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    return { ok: false as const, code: "timeout" as const, error: "DeepSeek 请求超时" };
  }, { backoffMs: 0 });
  assert.equal(calls, 2);
  assert.equal(outcome.attemptCount, 2);
  assert.deepEqual(outcome.result, { ok: false, code: "timeout", error: "DeepSeek 请求超时" });
});

test("thrown timeout errors are normalized to timeout code and retried", async () => {
  let calls = 0;
  const error = Object.assign(new Error("socket hang up"), { name: "TimeoutError" });
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    if (calls === 1) throw error;
    return { ok: true as const, value: "recovered" };
  }, { backoffMs: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(outcome.result, { ok: true, value: "recovered" });
});

test("client_error (4xx) is not retried", async () => {
  let calls = 0;
  const outcome = await withLimitedRetry(async () => {
    calls += 1;
    return { ok: false as const, code: "client_error" as const, error: "400 bad request" };
  }, { backoffMs: 0 });
  assert.equal(calls, 1);
  assert.equal(outcome.attemptCount, 1);
  assert.deepEqual(outcome.result, { ok: false, code: "client_error", error: "400 bad request" });
});
