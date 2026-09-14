import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync("app/generate/page.tsx", "utf8");
const apiRouteSource = readFileSync("app/api/sites/[siteId]/generate/route.ts", "utf8");

test("analyze uses the shared client hard deadline instead of a stale 45-second cutoff", () => {
  assert.match(routeSource, /const ANALYZE_TIMEOUT_MS = GENERATION_BUDGET\.clientHardDeadlineMs;/);
  assert.doesNotMatch(routeSource, /const ANALYZE_TIMEOUT_MS = 45_000;/);
  assert.doesNotMatch(routeSource, /需求分析已超过 45 秒/);
});

test("server analyze uses the shared server budget floor", () => {
  // 2026-09-08 重构：固定 serverDeadlineMs 已废弃，改用动态预算（floor 为下限）
  assert.match(apiRouteSource, /const ANALYZE_DEADLINE_MS = GENERATION_BUDGET\.serverDeadlineFloorMs;/);
  assert.doesNotMatch(apiRouteSource, /const ANALYZE_DEADLINE_MS = 60_000;/);
});

test("全量生成用动态预算而非固定截止", () => {
  assert.match(apiRouteSource, /computeGenerationBudgetMs\(\{\s*groupCount, concurrency: GENERATION_BUDGET\.groupConcurrency/);
  assert.doesNotMatch(apiRouteSource, /createGenerationDeadlines\(startedAt\);/);
});

/**
 * 2026-09-10 回归：预算公式的并发数必须与分组调度器的真实并发**同源**。
 *
 * 此前 `generate/route.ts` 硬编码 `concurrency: 2`，而 `site-generator.ts` 的分组并发
 * 是 `Math.max(1, MAX_INFLIGHT - 1)` = **1**（串行）→ 预算低估约一半
 * （4 组算出 192s，串行实需 ~360s）→ **每次生成必然砍掉尾部 1-2 个板块**。
 * 两处现已共用 `GENERATION_BUDGET.groupConcurrency`，本测试锁死这一点。
 */
test("分组调度器并发与预算公式并发同源（防再次漂移）", () => {
  const generatorSource = readFileSync("lib/site-generator.ts", "utf8");
  // 调度器必须消费共享常量，而不是再写死一个数字
  assert.match(
    generatorSource,
    /Math\.min\(GENERATION_BUDGET\.groupConcurrency, sectionGroups\.length\)/,
    "site-generator 的分组并发必须取自 GENERATION_BUDGET.groupConcurrency",
  );
  // 旧的写死表达式不得复活（只匹配真实赋值代码，不匹配注释里的说明文字：
  // 注释行以 `//` 或 `*` 开头，故要求 `MAX_GROUP_CONCURRENCY` 前不是注释起始符）
  assert.doesNotMatch(
    generatorSource,
    /^\s*const\s+MAX_GROUP_CONCURRENCY\s*=/m,
    "分组并发不得再写死为 MAX_INFLIGHT-1（会把并发降为 1，导致预算低估）",
  );
  // 预算侧的 concurrency 也不得再硬编码字面量
  assert.doesNotMatch(apiRouteSource, /computeGenerationBudgetMs\(\{\s*groupCount,\s*concurrency:\s*\d/);
});

test("预算接入实测 P95（observedAvgMs 不再是无调用点的死参数）", () => {
  assert.match(apiRouteSource, /observedAvgMs\s*=\s*averageGroupLatency\(/);
  // 单行内匹配即可：调用点写成 `computeGenerationBudgetMs({ groupCount, concurrency: ..., observedAvgMs })`
  assert.match(apiRouteSource, /computeGenerationBudgetMs\(\{[^\n]*observedAvgMs[^\n]*\}\)/);
});
