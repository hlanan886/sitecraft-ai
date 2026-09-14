import assert from "node:assert/strict";
import test from "node:test";
import { adversarialInputs } from "./fixtures/adversarial-inputs.ts";

test("adversarial input fixture covers every required validation family", () => {
  const names = new Set(adversarialInputs.map((item) => item.name));
  for (const required of [
    "empty-request",
    "long-chinese-request",
    "invalid-json",
    "unknown-operation",
    "unknown-template",
    "unknown-target",
    "prompt-injection",
    "malicious-html",
  ]) {
    assert.ok(names.has(required), `missing fixture: ${required}`);
  }
  assert.ok(adversarialInputs.every((item) => item.input.length <= 12_000));
});
