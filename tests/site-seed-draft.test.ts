import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import { createSite, getSite } from "../lib/site-store.ts";

test("createSite persists the normalized seed draft without inventing revision history", async () => {
  const initialDraft = structuredClone(defaultDraft);
  initialDraft.siteName = "Northstar Components";
  initialDraft.companyName = "Northstar Components";
  initialDraft.templateId = "forge";
  initialDraft.locale = "en";
  initialDraft.revision = 7;
  initialDraft.content.hero.title.en = "Server-backed industrial systems";
  initialDraft.content.products.title.en = "Server-backed product line";

  const created = await createSite({
    name: "Northstar Components",
    templateId: "forge",
    locales: ["en"],
    initialDraft,
  });
  const loaded = await getSite(created.id);

  assert.equal(loaded.draft.siteName, "Northstar Components");
  assert.equal(loaded.draft.companyName, "Northstar Components");
  assert.equal(loaded.draft.templateId, "forge");
  assert.equal(loaded.draft.locale, "en");
  assert.equal(loaded.draft.revision, 7);
  assert.equal(loaded.draft.content.hero.title.en, "Server-backed industrial systems");
  assert.equal(loaded.draft.content.products.title.en, "Server-backed product line");
  assert.deepEqual(loaded.history, []);
  assert.equal(loaded.canUndo, false);
  assert.equal(loaded.canRedo, false);
});
