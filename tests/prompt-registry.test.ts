import assert from "node:assert/strict";
import test from "node:test";
import { getPromptDefinition, promptRegistry } from "../lib/prompt-registry.ts";

test("production prompts have explicit immutable versions and fingerprints", () => {
  for (const definition of Object.values(promptRegistry)) {
    assert.match(definition.id, /^[a-z0-9_]+$/);
    assert.match(definition.version, /^v[0-9]+$/);
    assert.match(definition.fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("unknown prompt keys fail closed instead of becoming an unknown version", () => {
  assert.throws(
    () => getPromptDefinition("missing_prompt" as never),
    /Unknown prompt key/,
  );
});
