import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATION_BUDGET,
  clientTimeoutMs,
  computeGenerationBudgetMs,
  createGenerationDeadlines,
  createProgressGuard,
  getGenerationWaitNotice,
  getRemainingStageTimeout,
  hasFallbackBudget,
} from "../lib/generation-budget.ts";

test("generation budget derives warning, server and client deadlines from one start time", () => {
  const deadlines = createGenerationDeadlines(1_000);

  assert.deepEqual(deadlines, {
    slowNoticeAt: 31_000,
    extendedNoticeAt: 56_000,
    serverDeadlineAt: 116_000,
    clientDeadlineAt: 121_000,
    workDeadlineAt: 111_000,
  });
});

test("stage timeout is capped by the stage and preserves the commit reserve", () => {
  assert.equal(getRemainingStageTimeout({ deadlineAt: 116_000, now: 1_000, stageCapMs: 60_000, reserveMs: 5_000 }), 60_000);
  assert.equal(getRemainingStageTimeout({ deadlineAt: 116_000, now: 112_500, stageCapMs: 60_000, reserveMs: 5_000 }), 0);
  assert.equal(getRemainingStageTimeout({ deadlineAt: 116_000, now: 109_000, stageCapMs: 60_000, reserveMs: 5_000 }), 2_000);
});

test("compatible-template fallback starts only with at least 25 seconds remaining", () => {
  assert.equal(hasFallbackBudget(24_999), false);
  assert.equal(hasFallbackBudget(25_000), true);
});

test("generation wait notice escalates at 30 and 55 seconds without ending the request", () => {
  assert.equal(getGenerationWaitNotice(29_999), null);
  assert.equal(getGenerationWaitNotice(30_000), "模型响应较慢，仍在生成；已完成的内容会保留。");
  assert.equal(getGenerationWaitNotice(54_999), "模型响应较慢，仍在生成；已完成的内容会保留。");
  assert.equal(getGenerationWaitNotice(55_000), "已进入延长处理，正在隔离慢板块并准备可用初稿。");
});

// ===== 动态预算（2026-09-08 重构：替代固定 115s） =====

test("computeGenerationBudgetMs: 组多时预算更大（不再是固定值）", () => {
  const few = computeGenerationBudgetMs({ groupCount: 2, concurrency: 2 });
  const many = computeGenerationBudgetMs({ groupCount: 5, concurrency: 2 });
  assert.ok(many > few, `5 组预算(${many})应大于 2 组(${few})`);
});

test("computeGenerationBudgetMs: 覆盖实测最坏场景（5 组/并发 2/单组 85s）", () => {
  const budget = computeGenerationBudgetMs({ groupCount: 5, concurrency: 2, observedAvgMs: 85_000 });
  assert.ok(budget >= 255_000, `预算 ${budget} 应覆盖 3 波 × 85s`);
});

test("computeGenerationBudgetMs: 夹在下限与上限之间", () => {
  const tiny = computeGenerationBudgetMs({ groupCount: 1, concurrency: 4, observedAvgMs: 1_000 });
  assert.equal(tiny, GENERATION_BUDGET.serverDeadlineFloorMs, "低于下限时用下限");
  const huge = computeGenerationBudgetMs({ groupCount: 20, concurrency: 1, observedAvgMs: 100_000 });
  assert.equal(huge, GENERATION_BUDGET.serverDeadlineCeilingMs, "高于上限时用上限");
});

// ===== 客户端预算联动（修复"服务端 600s、客户端 120s 就断"） =====

test("clientTimeoutMs: 跟随服务端预算 + 宽限", () => {
  assert.equal(clientTimeoutMs(300_000), 315_000, "服务端 300s → 客户端 315s");
  assert.equal(clientTimeoutMs(10_000), GENERATION_BUDGET.clientHardDeadlineMs, "服务端预算小时不低于客户端下限");
});

// ===== 进展感知（替代总时长硬砍） =====

test("createProgressGuard: 持续进展则永不判定停滞（总时长可远超预算）", () => {
  let now = 0;
  const guard = createProgressGuard(90_000, () => now);
  for (let i = 0; i < 10; i += 1) {
    now += 50_000;
    guard.progress();
  }
  assert.equal(guard.isStalled(), false, "总耗时 500s 但持续有进展 → 不应停滞");
});

test("createProgressGuard: 静默超过阈值才判定停滞", () => {
  let now = 0;
  const guard = createProgressGuard(90_000, () => now);
  guard.progress();
  now = 80_000;
  assert.equal(guard.isStalled(), false);
  now = 91_000;
  assert.equal(guard.isStalled(), true, "静默 91s > 90s → 停滞");
});

test("createProgressGuard: hasProgress 反映是否曾有进展", () => {
  const guard = createProgressGuard(1_000);
  assert.equal(guard.hasProgress(), false);
  guard.progress();
  assert.equal(guard.hasProgress(), true);
});
