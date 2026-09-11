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

test("server analyze uses the shared server deadline", () => {
  assert.match(apiRouteSource, /const ANALYZE_DEADLINE_MS = GENERATION_BUDGET\.serverDeadlineMs;/);
  assert.doesNotMatch(apiRouteSource, /const ANALYZE_DEADLINE_MS = 60_000;/);
});
