import assert from "node:assert/strict";
import test from "node:test";
import { withLimitedRetry, type RetryTaskResult } from "../lib/ai-retry.ts";

function ok<T>(value: T): RetryTaskResult<T> {
  return { ok: true, value };
}
function timeout<T>(error = "timeout"): RetryTaskResult<T> {
  return { ok: false, code: "timeout", error };
}
function clientError<T>(): RetryTaskResult<T> {
  return { ok: false, code: "client_error", error: "400 bad request" };
}

test("retries once after a timeout and succeeds on second attempt", async () => {
  let calls = 0;
  const out = await withLimitedRetry(async () => {
    calls += 1;
    if (calls === 1) return timeout<string>();
    return ok("success");
  });
  assert.equal(calls, 2);
  assert.equal(out.attemptCount, 2);
  assert.equal(out.result.ok, true);
  if (out.result.ok) assert.equal(out.result.value, "success");
});

test("returns timeout after both attempts time out", async () => {
  let calls = 0;
  const out = await withLimitedRetry(async () => {
    calls += 1;
    return timeout<string>();
  });
  assert.equal(calls, 2);
  assert.equal(out.attemptCount, 2);
  assert.equal(out.result.ok, false);
  if (!out.result.ok) assert.equal(out.result.code, "timeout");
});

test("succeeds immediately on first attempt without extra calls", async () => {
  let calls = 0;
  const out = await withLimitedRetry(async () => {
    calls += 1;
    return ok("fast");
  });
  assert.equal(calls, 1);
  assert.equal(out.attemptCount, 1);
  assert.equal(out.result.ok, true);
});

test("does not retry client errors (4xx)", async () => {
  let calls = 0;
  const out = await withLimitedRetry(async () => {
    calls += 1;
    return clientError<string>();
  });
  assert.equal(calls, 1);
  assert.equal(out.result.ok, false);
});

test("does not retry invalid_output (schema failure handled by caller)", async () => {
  let calls = 0;
  const out = await withLimitedRetry(async () => {
    calls += 1;
    return { ok: false as const, code: "invalid_output" as const, error: "schema" };
  });
  assert.equal(calls, 1);
  assert.equal(out.result.ok, false);
});

test("retries on thrown timeout errors", async () => {
  let calls = 0;
  const out = await withLimitedRetry<string>(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return ok("recovered");
  }, { isTimeoutError: (e) => e instanceof Error && e.name === "AbortError" });
  assert.equal(calls, 2);
  assert.equal(out.result.ok, true);
  if (out.result.ok) assert.equal(out.result.value, "recovered");
});

test("retries on generic network errors", async () => {
  let calls = 0;
  const out = await withLimitedRetry<string>(async () => {
    calls += 1;
    if (calls === 1) throw new Error("ECONNRESET");
    return ok("recovered");
  });
  assert.equal(calls, 2);
  assert.equal(out.result.ok, true);
});
