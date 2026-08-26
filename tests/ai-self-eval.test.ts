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

test("shouldSelfEvaluate: triggers on cross-module 2-operation edit (P3)", () => {
  // 两目标跨模块（features 卡片 + companyName）→ 应触发自评
  const crossModule: SiteOperation[] = [
    { op: "update_card", section: "features", index: 2, locale: "zh", body: "统一询价" },
    { op: "set_text", target: "companyName", locale: "zh", value: "华辰精工" },
  ];
  assert.equal(shouldSelfEvaluate(crossModule), true);
});

test("shouldSelfEvaluate: does not trigger on same-module 2-field edit (P3)", () => {
  // 同一模块（hero）两个字段 → 不触发（避免不必要自评）
  const sameModule: SiteOperation[] = [
    { op: "set_text", target: "hero.title", locale: "zh", value: "x" },
    { op: "set_text", target: "hero.subtitle", locale: "zh", value: "y" },
  ];
  assert.equal(shouldSelfEvaluate(sameModule), false);
  // 同一卡片 title+body → 不触发
  const sameCard: SiteOperation[] = [
    { op: "update_card", section: "services", index: 0, locale: "zh", title: "a", body: "b" },
  ];
  assert.equal(shouldSelfEvaluate(sameCard), false);
});

test("shouldSelfEvaluate: triggers on instruction-level multi-target even when model outputs few ops (P3)", () => {
  // 模型只输出 1 个操作，但用户指令明确要求改两个模块 → 应触发
  const single: SiteOperation[] = [
    { op: "update_card", section: "features", index: 2, locale: "zh", body: "询价沟通" },
  ];
  assert.equal(shouldSelfEvaluate(single, "把第三个优势卡片说明改短，另外公司名改成华辰精工"), true);
  // 无多目标连接词的单目标指令 → 不触发
  assert.equal(shouldSelfEvaluate(single, "把首屏标题改短一点"), false);
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
