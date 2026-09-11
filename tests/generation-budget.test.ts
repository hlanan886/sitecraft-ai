import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenerationDeadlines,
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
