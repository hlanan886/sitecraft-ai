import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat and generate routes expose scoped idempotency handling", async () => {
  const [chat, generate] = await Promise.all([
    readFile(new URL("../app/api/sites/[siteId]/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sites/[siteId]/generate/route.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [chat, generate]) {
    assert.match(source, /idempotencyKey: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(128\)\.optional\(\)/);
    assert.match(source, /requestIdempotency\.begin\(/);
    assert.match(source, /requestIdempotency\.complete\(/);
    assert.match(source, /buildSseReplayResponse\(/);
  }
  assert.match(chat, /`chat:\$\{siteId\}`/);
  assert.match(generate, /`generate:\$\{siteId\}`/);
});

test("primary generation and chat actions send a request idempotency key", async () => {
  const [generatePage, workspacePage] = await Promise.all([
    readFile(new URL("../app/generate/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(generatePage, /idempotencyKey/);
  assert.match(workspacePage, /idempotencyKey/);
});

test("generation actions surface JSON errors before parsing an SSE body", async () => {
  const generatePage = await readFile(new URL("../app/generate/page.tsx", import.meta.url), "utf8");

  assert.match(generatePage, /需求分析请求失败，请稍后重试/);
  assert.match(generatePage, /生成请求失败，请稍后重试/);
  assert.match(generatePage, /补全请求失败，请稍后重试/);
});
