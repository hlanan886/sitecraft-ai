import assert from "node:assert/strict";
import test from "node:test";
import { isGenerationRecordEnabled, recordGeneration, listGenerationRecords, summarizeGenerationRecords, type GenerationRecord } from "../lib/generation-record.ts";
import type { SiteIntent } from "../lib/site-intent.ts";

// 单测环境无 PG（SITE_STORE 非 postgres）→ usePostgres=false，recordGeneration 应直接返回不崩
// PG 真实写入靠真机验证（npm run test:e2e:real）

const intent: SiteIntent = {
  businessType: "trade",
  companyName: "华辰光伏",
  industry: "光伏组件出口",
  targetAudience: "overseasB2b",
  tone: "professional",
  colorTone: "green",
  coreSections: ["about", "features", "products", "contact"],
  recommendedTemplateId: "atlas",
  summary: "光伏出口企业的双语官网",
};

test("isGenerationRecordEnabled: false in non-postgres test env", () => {
  assert.equal(isGenerationRecordEnabled(), false);
});

test("recordGeneration: no-op (no throw) without postgres", async () => {
  // 不应抛错，静默返回（fail-open）
  await recordGeneration({
    siteId: "demo",
    inputText: "做个光伏官网",
    intent,
    operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "可靠光伏" }],
    templateId: "atlas",
    latencyMs: 1200,
    model: "deepseek-v4-flash",
    status: "applied",
    outcome: "complete",
    mode: "full",
    missingSections: [],
    requestedTemplateId: "atlas",
    appliedTemplateId: "atlas",
  });
  assert.ok(true);
});

test("listGenerationRecords: empty without postgres", async () => {
  const records = await listGenerationRecords(10);
  assert.deepEqual(records, []);
});

test("summarizeGenerationRecords: uses explicit full-generation denominators and nearest-rank percentiles", () => {
  const base: Omit<GenerationRecord, "id" | "latencyMs" | "outcome" | "createdAt"> = {
    siteId: "site-1",
    inputText: "做个光伏官网",
    intent,
    operations: [],
    templateId: "atlas",
    model: "test",
    status: "applied",
    detail: "",
    mode: "full",
    missingSections: [],
    requestedTemplateId: "atlas",
    appliedTemplateId: "atlas",
    fallbackReason: "",
    errorCode: "",
  };
  const record = (id: number, latencyMs: number, outcome: GenerationRecord["outcome"], overrides: Partial<GenerationRecord> = {}): GenerationRecord => ({
    ...base,
    id,
    latencyMs,
    outcome,
    createdAt: new Date(id * 1000).toISOString(),
    ...overrides,
  });
  const metrics = summarizeGenerationRecords([
    record(1, 1_000, "complete"),
    record(2, 2_000, "partial", { missingSections: ["about"], requestedTemplateId: "atlas", appliedTemplateId: "forge", fallbackReason: "模板异常" }),
    record(3, 10_000, "error", { status: "error", errorCode: "timeout" }),
    record(4, 4_000, "conflict", { status: "conflict" }),
    record(5, 500, "complete", { mode: "regenerate" }),
  ]);

  assert.equal(metrics.sampleSize, 4);
  assert.equal(metrics.delivered, 2);
  assert.equal(metrics.deliveryRate, 0.5);
  assert.equal(metrics.partialRate, 0.5);
  assert.equal(metrics.templateFallbackRate, 0.5);
  assert.equal(metrics.failureRate, 0.5);
  assert.equal(metrics.timeoutRate, 0.25);
  assert.equal(metrics.p50LatencyMs, 2_000);
  assert.equal(metrics.p95LatencyMs, 10_000);
});

test("summarizeGenerationRecords: empty samples return null latency and zero rates", () => {
  assert.deepEqual(summarizeGenerationRecords([]), {
    sampleSize: 0,
    delivered: 0,
    deliveryRate: 0,
    partialRate: 0,
    templateFallbackRate: 0,
    failureRate: 0,
    timeoutRate: 0,
    p50LatencyMs: null,
    p95LatencyMs: null,
  });
});
