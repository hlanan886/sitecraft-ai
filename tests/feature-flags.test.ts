import assert from "node:assert/strict";
import test from "node:test";
import {
  FEATURE_FLAG_KEYS,
  getFeatureFlagSnapshot,
  isFeatureEnabled,
  parseFeatureFlags,
  type FeatureFlagKey,
} from "../lib/feature-flags.ts";

test("feature flags are off by default and expose the stable flag set", () => {
  const flags = parseFeatureFlags({});

  assert.deepEqual(FEATURE_FLAG_KEYS, [
    "template_matching_v2",
    "quality_gate_v1",
    "chat_cas_v1",
    "release_v1",
    "access_scope_v1",
  ]);
  assert.equal(flags.template_matching_v2, false);
  assert.equal(flags.quality_gate_v1, false);
  assert.equal(flags.chat_cas_v1, false);
  assert.equal(flags.release_v1, false);
  assert.equal(flags.access_scope_v1, false);
});

test("comma-separated environment flags accept only known names and true values", () => {
  const flags = parseFeatureFlags({
    SITECRAFT_FEATURE_FLAGS: "quality_gate_v1, release_v1,unknown",
  });

  assert.equal(flags.quality_gate_v1, true);
  assert.equal(flags.release_v1, true);
  assert.equal(flags.template_matching_v2, false);
  assert.equal(flags.access_scope_v1, false);
});

test("per-flag environment values override the list without enabling unknown flags", () => {
  const flags = parseFeatureFlags({
    SITECRAFT_FEATURE_FLAGS: "quality_gate_v1,release_v1",
    SITECRAFT_FLAG_QUALITY_GATE_V1: "false",
    SITECRAFT_FLAG_CHAT_CAS_V1: "true",
    SITECRAFT_FLAG_NOT_A_FLAG: "true",
  });

  assert.equal(flags.quality_gate_v1, false);
  assert.equal(flags.release_v1, true);
  assert.equal(flags.chat_cas_v1, true);
});

test("canary workspace can enable a flag without enabling it for every workspace", () => {
  const env = {
    SITECRAFT_FEATURE_FLAGS: "release_v1",
    SITECRAFT_CANARY_WORKSPACES: "canary-a, canary-b",
    SITECRAFT_CANARY_FLAGS: "template_matching_v2,quality_gate_v1",
  };

  assert.equal(isFeatureEnabled("release_v1", "normal", env), true);
  assert.equal(isFeatureEnabled("template_matching_v2", "normal", env), false);
  assert.equal(isFeatureEnabled("template_matching_v2", "canary-a", env), true);
  assert.equal(isFeatureEnabled("quality_gate_v1", "canary-b", env), true);
  assert.equal(isFeatureEnabled("chat_cas_v1", "canary-a", env), false);
});

test("snapshot is deterministic and includes canary metadata for operations diagnostics", () => {
  const snapshot = getFeatureFlagSnapshot({
    SITECRAFT_FEATURE_FLAGS: "release_v1",
    SITECRAFT_CANARY_WORKSPACES: "canary-a",
    SITECRAFT_CANARY_FLAGS: "quality_gate_v1",
  }, "canary-a");

  assert.deepEqual(snapshot, {
    workspaceId: "canary-a",
    flags: {
      template_matching_v2: false,
      quality_gate_v1: true,
      chat_cas_v1: false,
      release_v1: true,
      access_scope_v1: false,
    },
    canary: true,
  });
});

test("flag key type remains limited to the documented set", () => {
  const key: FeatureFlagKey = "release_v1";
  assert.equal(key, "release_v1");
});
