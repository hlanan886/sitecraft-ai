import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createGenerationProvenance } from "../lib/generation-record.ts";
import { commitOperations, getSite } from "../lib/site-store.ts";

function siteFile(siteId: string) {
  return path.join(process.cwd(), ".sitecraft-data", "sites", `${siteId}.json`);
}

test("AI chat commit persists provenance with target and revision metadata", async () => {
  const siteId = `chat-provenance-${crypto.randomUUID()}`;
  try {
    const initial = await getSite(siteId);
    const provenance = {
      ...createGenerationProvenance({
        provider: "DeepSeek",
        model: "deepseek-v4-flash",
        promptKey: "chat_operations",
        manifestVersion: 1,
        templateId: initial.draft.templateId,
        buildRevision: initial.draft.revision,
        inputText: "把首屏标题改成可靠交付",
      }),
      baseRevision: initial.draft.revision,
      selectedTarget: "hero.title",
    };

    const committed = await commitOperations({
      siteId,
      baseRevision: initial.draft.revision,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "可靠交付" }],
      summary: "更新首屏标题",
      source: "ai",
      model: "deepseek-v4-flash",
      provenance,
    });

    assert.equal(committed.status, "applied");
    if (committed.status !== "applied") return;
    const stored = committed.changeSet.provenance;
    assert.ok(stored, "AI changes must retain provenance");
    assert.equal(stored.promptId, "chat_operations");
    assert.equal(stored.baseRevision, initial.draft.revision);
    assert.equal(stored.resultRevision, committed.changeSet.revision);
    assert.deepEqual(stored.appliedTargets, ["hero.title.zh"]);
    assert.equal(stored.selectedTarget, "hero.title");
    assert.equal("inputText" in stored, false);

    const reloaded = await getSite(siteId);
    assert.equal(reloaded.history[0]?.provenance?.resultRevision, committed.changeSet.revision);
  } finally {
    await unlink(siteFile(siteId)).catch(() => undefined);
  }
});
