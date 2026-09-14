import assert from "node:assert/strict";
import test from "node:test";
import { buildSseReplayResponse } from "../lib/sse-response.ts";

test("SSE replay returns the original terminal event with stream headers", async () => {
  const done = { type: "done", status: "applied", revision: 4, requestId: "req-1", taskId: "task-1", sequence: 3 };
  const response = buildSseReplayResponse(done);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.text(), `data: ${JSON.stringify(done)}\n\n`);
});
