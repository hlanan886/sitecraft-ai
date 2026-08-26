import assert from "node:assert/strict";
import test from "node:test";
import type { SiteOperation } from "../lib/site-operations.ts";
import {
  evaluateOperations,
  MIN_SELF_EVAL_OPERATIONS,
  parseSelfEvaluation,
  selectRetryIssues,
  shouldSelfEvaluate,
} from "../lib/ai-self-eval.ts";

const ops = (n: number): SiteOperation[] =>
  Array.from({ length: n }, (_, i) => ({
    op: "set_text" as const,
    target: "hero.title" as const,
    locale: "zh" as const,
    value: `标题${i}`,
  }));

test("shouldSelfEvaluate: triggers on >=3 operations", () => {
  assert.equal(shouldSelfEvaluate(ops(1)), false);
  assert.equal(shouldSelfEvaluate(ops(2)), false);
  assert.equal(shouldSelfEvaluate(ops(MIN_SELF_EVAL_OPERATIONS)), true);
});

test("shouldSelfEvaluate: triggers on destructive operations", () => {
  const withRemove: SiteOperation[] = [
    { op: "set_text", target: "hero.title", locale: "zh", value: "x" },
    { op: "remove_card", section: "services", itemId: "delivery" },
  ];
  assert.equal(shouldSelfEvaluate(withRemove), true);
  const withTemplate: SiteOperation[] = [
    { op: "set_text", target: "hero.title", locale: "zh", value: "x" },
    { op: "set_template", templateId: "kindred" },
  ];
  assert.equal(shouldSelfEvaluate(withTemplate), true);
});

test("parseSelfEvaluation: parses valid JSON with fences", () => {
  const r = parseSelfEvaluation('```json\n{"ok":false,"issues":[{"severity":"error","code":"scope","message":"改了未要求对象"}]}\n```');
  assert.equal(r.error, "");
  assert.equal(r.data?.ok, false);
  assert.equal(r.data?.issues[0].code, "scope");
});

test("parseSelfEvaluation: fails on invalid JSON", () => {
  const r = parseSelfEvaluation("not json");
  assert.equal(r.data, null);
  assert.ok(r.error.length > 0);
});

test("parseSelfEvaluation: fails on invalid fields (unknown code)", () => {
  const r = parseSelfEvaluation('{"ok":true,"issues":[{"severity":"error","code":"unknown_code","message":"x"}]}');
  assert.equal(r.data, null);
});

test("selectRetryIssues: only picks error severity, caps length", () => {
  const text = selectRetryIssues([
    { severity: "error", code: "scope", message: "改了未要求对象" },
    { severity: "warning", code: "copy", message: "略长" },
    { severity: "error", code: "locale", message: "语言不一致" },
  ]);
  assert.match(text, /scope/);
  assert.match(text, /locale/);
  assert.ok(!text.includes("略长")); // warning 不参与重试
});

test("evaluateOperations: fail-open on missing config", async () => {
  const prev = { ...process.env };
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_API_KEY;
  const r = await evaluateOperations({
    message: "改首屏",
    summary: "s",
    operations: ops(3),
    templateId: "forge",
  });
  process.env = prev;
  assert.equal(r.ok, true);
  assert.equal(r.issues.length, 0);
});

test("evaluateOperations: fail-open on fetch error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  const prev = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "sk-test";
  process.env.DEEPSEEK_MODEL = "m";
  const r = await evaluateOperations({ message: "x", summary: "s", operations: ops(3), templateId: "forge" });
  process.env = prev;
  globalThis.fetch = originalFetch;
  assert.equal(r.ok, true);
  assert.equal(r.issues.length, 0);
});

test("evaluateOperations: parses model verdict on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":false,"issues":[{"severity":"error","code":"copy","message":"太长"}]}' } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const prev = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "sk-test";
  process.env.DEEPSEEK_MODEL = "m";
  const r = await evaluateOperations({ message: "x", summary: "s", operations: ops(3), templateId: "forge" });
  process.env = prev;
  globalThis.fetch = originalFetch;
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, "copy");
});
