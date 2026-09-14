import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTIVE_DEFAULTS,
  adaptiveTimeoutMs,
  createStallGuard,
  percentile95,
  planSectionGroups,
  recordLatency,
  resetLatencySamples,
} from "../lib/generation-reliability.ts";

// ===== 自适应超时 =====

test("adaptiveTimeoutMs: 无历史样本时用 initialMs", () => {
  resetLatencySamples();
  assert.equal(adaptiveTimeoutMs("tpl:forge:batch"), ADAPTIVE_DEFAULTS.initialMs);
});

test("adaptiveTimeoutMs: 有历史时按 P95 × 1.5（夹在上下限内）", () => {
  resetLatencySamples();
  for (const ms of [50_000, 55_000, 60_000, 70_000]) recordLatency({ taskKey: "k1", latencyMs: ms, ok: true });
  const timeout = adaptiveTimeoutMs("k1");
  const p95 = percentile95("k1");
  assert.ok(p95);
  assert.equal(timeout, Math.min(ADAPTIVE_DEFAULTS.ceilingMs, Math.max(ADAPTIVE_DEFAULTS.floorMs, Math.round(p95 * 1.5))));
});

test("adaptiveTimeoutMs: 极慢历史被 ceiling 夹住，不会无限增长", () => {
  resetLatencySamples();
  for (const ms of [300_000, 320_000, 350_000, 400_000]) recordLatency({ taskKey: "k2", latencyMs: ms, ok: true });
  assert.equal(adaptiveTimeoutMs("k2"), ADAPTIVE_DEFAULTS.ceilingMs);
});

test("adaptiveTimeoutMs: 极快历史被 floor 夹住，不会误杀", () => {
  resetLatencySamples();
  for (const ms of [1_000, 1_200, 1_500, 2_000]) recordLatency({ taskKey: "k3", latencyMs: ms, ok: true });
  assert.equal(adaptiveTimeoutMs("k3"), ADAPTIVE_DEFAULTS.floorMs);
});

test("recordLatency: 失败样本不污染基线", () => {
  resetLatencySamples();
  for (const ms of [10_000, 11_000, 12_000]) recordLatency({ taskKey: "k4", latencyMs: ms, ok: true });
  const before = percentile95("k4");
  recordLatency({ taskKey: "k4", latencyMs: 200_000, ok: false }); // 超时失败
  assert.equal(percentile95("k4"), before, "失败的慢样本不应进入统计");
});

test("percentile95: 样本不足 3 个时返回 undefined", () => {
  resetLatencySamples();
  recordLatency({ taskKey: "k5", latencyMs: 1000, ok: true });
  recordLatency({ taskKey: "k5", latencyMs: 2000, ok: true });
  assert.equal(percentile95("k5"), undefined);
});

// ===== 分而治之 =====

test("planSectionGroups: 重板块单独成批，轻板块可合并", () => {
  const groups = planSectionGroups(["about", "contact", "features", "services", "products"]);
  // features/services/products 各自单独成批
  const heavyGroups = groups.filter((g) => g.sections.length === 1 && ["features", "services", "products"].includes(g.sections[0]));
  assert.equal(heavyGroups.length, 3);
  // about + contact 合并
  const lightGroup = groups.find((g) => g.sections.includes("about") && g.sections.includes("contact"));
  assert.ok(lightGroup, "轻板块应合并成一批");
});

test("planSectionGroups: 全部覆盖且不重复", () => {
  const sections = ["about", "features", "services", "products", "contact"];
  const groups = planSectionGroups(sections);
  const flat = groups.flatMap((g) => g.sections);
  assert.equal(flat.length, sections.length);
  assert.deepEqual([...flat].sort(), [...sections].sort());
});

test("planSectionGroups: 空输入返回空", () => {
  assert.deepEqual(planSectionGroups([]), []);
});

// ===== 停滞检测 =====

test("createStallGuard: 持续进展则不判定停滞", () => {
  let now = 0;
  const guard = createStallGuard(1000, () => now);
  now = 900;
  guard.progress();
  now = 1500;
  assert.equal(guard.isStalled(), false, "距上次进展 600ms < 1000ms");
  assert.equal(guard.idleMs(), 600);
});

test("createStallGuard: 超时无进展判定停滞", () => {
  let now = 0;
  const guard = createStallGuard(1000, () => now);
  now = 1500;
  assert.equal(guard.isStalled(), true);
});

// ===== 分组规划 =====
