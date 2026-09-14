import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredPreflightFailure } from "../e2e/scripts/preflight-result.mjs";

test("preflight ignores a free test server port", () => {
  assert.equal(hasRequiredPreflightFailure({
    envLocal: true,
    nodeModules: true,
    playwright: true,
    chromiumCache: true,
    postgres: true,
    testServerPortOccupied: false,
  }), false);
});

test("preflight fails when a required dependency is missing", () => {
  assert.equal(hasRequiredPreflightFailure({
    envLocal: true,
    nodeModules: true,
    playwright: false,
    chromiumCache: true,
    postgres: true,
    testServerPortOccupied: false,
  }), true);
});
