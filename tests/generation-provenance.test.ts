import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationProvenance } from "../lib/generation-record.ts";
import { readFileSync } from "node:fs";

test("generation provenance stores a hash instead of the original input", () => {
  const input = "华辰精密制造，主营工业紧固件，服务出口客户。";
  const provenance = createGenerationProvenance({
    provider: "DeepSeek",
    model: "deepseek-v4-flash",
    promptKey: "draft_operations",
    manifestVersion: 1,
    templateId: "screwfast",
    buildRevision: 7,
    inputText: input,
  });

  assert.equal(provenance.provider, "DeepSeek");
  assert.equal(provenance.model, "deepseek-v4-flash");
  assert.equal(provenance.promptId, "draft_operations");
  assert.equal(provenance.promptVersion, "v1");
  assert.equal(provenance.manifestVersion, 1);
  assert.equal(provenance.templateId, "screwfast");
  assert.equal(provenance.buildRevision, 7);
  assert.match(provenance.inputHash, /^[a-f0-9]{64}$/);
  assert.equal("inputText" in provenance, false);
});

test("provenance rejects an unregistered prompt key", () => {
  assert.throws(
    () => createGenerationProvenance({
      provider: "DeepSeek",
      model: "deepseek-v4-flash",
      promptKey: "missing_prompt" as never,
      manifestVersion: 1,
      templateId: "screwfast",
      buildRevision: 1,
      inputText: "测试",
    }),
    /Unknown prompt key/,
  );
});

test("generation record listing never selects raw input text", () => {
  const source = readFileSync("lib/generation-record.ts", "utf8");
  assert.match(source, /''::text AS "inputText"/);
  assert.doesNotMatch(source, /input_text AS "inputText"/);
});
