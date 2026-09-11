import assert from "node:assert/strict";
import test from "node:test";
import { executeChatTaskPlan, mergeChatTaskResults } from "../lib/chat-task-executor.ts";
import { requestStructuredOperations, type ProviderResult } from "../lib/ai-provider.ts";
import { defaultDraft } from "../lib/site-document.ts";
import type { ChatTask } from "../lib/chat-task-planner.ts";

function task(id: string, instruction: string, scopes: ChatTask["scopes"]): ChatTask {
  return { id, instruction, scopes, productSkus: [], selectedTarget: null, depth: 0 };
}

function success(operations: (ProviderResult & { ok: true })["operations"], summary = "完成"): ProviderResult & { ok: true } {
  return { ok: true, summary, operations, rejected: [], model: "test", latencyMs: 5, attemptCount: 1 };
}

test("executeChatTaskPlan runs at most two providers and merges all successful batches", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await executeChatTaskPlan({
    tasks: [task("1", "修改首屏", ["hero"]), task("2", "修改关于", ["about"]), task("3", "修改联系", ["contact"])],
    deadlineAt: Date.now() + 1_000,
    maxConcurrency: 2,
    runTask: async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      const target = item.scopes[0] === "hero" ? "hero.title" : item.scopes[0] === "about" ? "about.title" : "contact.title";
      return success([{ op: "set_text", target, locale: "zh", value: item.instruction }]);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(maxActive, 2);
  if (result.ok) assert.equal(result.operations.length, 3);
});

test("executeChatTaskPlan splits output_truncated and never retries an identical request", async () => {
  const calls: string[] = [];
  const result = await executeChatTaskPlan({
    tasks: [task("1", "修改首屏标题并且修改首屏副标题", ["hero"])],
    deadlineAt: Date.now() + 1_000,
    runTask: async (item) => {
      const key = `${item.scopes.join(",")}|${item.instruction}`;
      calls.push(key);
      if (item.instruction.includes("并且")) {
        return { ok: false, code: "output_truncated", error: "截断", model: "test", latencyMs: 2, attemptCount: 1 };
      }
      return success([{ op: "set_text", target: item.instruction.includes("副标题") ? "hero.subtitle" : "hero.title", locale: "zh", value: item.instruction }]);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(calls.length, 3);
  if (result.ok) assert.equal(result.operations.length, 2);
});

test("executeChatTaskPlan exposes no committable operations when any required batch fails", async () => {
  const result = await executeChatTaskPlan({
    tasks: [task("1", "修改首屏", ["hero"]), task("2", "修改关于", ["about"])],
    deadlineAt: Date.now() + 1_000,
    runTask: async (item) => item.id === "1"
      ? success([{ op: "set_text", target: "hero.title", locale: "zh", value: "完成" }])
      : { ok: false, code: "provider_error", error: "失败", model: "test", latencyMs: 3, attemptCount: 1 },
  });

  assert.equal(result.ok, false);
  assert.equal("operations" in result, false);
});

test("mergeChatTaskResults deduplicates identical operations and rejects conflicts", () => {
  const duplicate = { op: "set_text" as const, target: "hero.title" as const, locale: "zh" as const, value: "可靠制造" };
  const merged = mergeChatTaskResults([success([duplicate], "首屏"), success([duplicate], "首屏")]);
  assert.equal(merged.ok, true);
  if (merged.ok) assert.equal(merged.operations.length, 1);

  const conflict = mergeChatTaskResults([
    success([duplicate]),
    success([{ ...duplicate, value: "另一标题" }]),
  ]);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "operation_conflict");
});

test("mergeChatTaskResults rejects more than 32 aggregated operations", () => {
  const operations = Array.from({ length: 33 }, (_, index) => ({
    op: "update_product" as const,
    sku: `SKU-${index}`,
    locale: "zh" as const,
    name: `产品 ${index}`,
  }));
  const result = mergeChatTaskResults([success(operations)]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "too_many_operations");
});

test("requestStructuredOperations returns output_truncated after one provider call and honors scoped options", async () => {
  const previous = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "test-model";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody: { max_tokens?: number; messages?: Array<{ content?: string }> } | undefined;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  }) as typeof fetch;

  try {
    const result = await requestStructuredOperations({
      message: "同时修改首屏标题和副标题",
      draft: defaultDraft,
      templateId: "forge",
      scope: { sections: ["hero"], productSkus: [] },
      maxAttempts: 2,
      maxTokens: 2_200,
      deadlineAt: Date.now() + 1_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "output_truncated");
    assert.equal(calls, 1);
    assert.equal(requestBody?.max_tokens, 2_200);
    assert.doesNotMatch(requestBody?.messages?.[1]?.content ?? "", /Certainty for complex projects/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = previous;
  }
});
