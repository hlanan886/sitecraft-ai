import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  commitOperations,
  getSite,
  isConversationalUndoMessage,
  undoLatestAiChange,
} from "../lib/site-store.ts";

function siteFile(siteId: string) {
  return path.join(process.cwd(), ".sitecraft-data", "sites", `${siteId}.json`);
}

test("conversational undo recognizes only explicit previous AI change requests", () => {
  assert.equal(isConversationalUndoMessage("改回上一条"), true);
  assert.equal(isConversationalUndoMessage("撤销刚才 AI 修改"), true);
  assert.equal(isConversationalUndoMessage("请帮我恢复到上一次 AI 修改前"), true);
  assert.equal(isConversationalUndoMessage("撤销导入的产品"), false);
  assert.equal(isConversationalUndoMessage("把上一条产品描述改短"), false);
});

test("latest AI change is reverted through one new history revision", async () => {
  const siteId = `undo-ai-latest-${crypto.randomUUID()}`;
  try {
    const initial = await getSite(siteId);
    const originalTitle = initial.draft.content.hero.title.zh;
    const ai = await commitOperations({
      siteId,
      baseRevision: initial.draft.revision,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "AI 生成的首屏标题" }],
      summary: "AI 重写首屏标题",
      source: "ai",
    });
    assert.equal(ai.status, "applied");
    if (ai.status !== "applied") return;

    const undone = await undoLatestAiChange({ siteId, baseRevision: ai.record.draft.revision });

    assert.equal(undone.status, "applied");
    if (undone.status !== "applied") return;
    assert.equal(undone.undoneChange.id, ai.changeSet.id);
    assert.equal(undone.undoneChange.summary, "AI 重写首屏标题");
    assert.equal(undone.record.draft.content.hero.title.zh, originalTitle);
    assert.equal(undone.record.draft.revision, ai.record.draft.revision + 1);
    assert.equal(undone.record.history.length, 2);
    assert.equal(undone.changeSet.source, "manual");
    assert.match(undone.changeSet.summary, /AI 重写首屏标题/);
  } finally {
    await unlink(siteFile(siteId)).catch(() => undefined);
  }
});

test("an interleaved manual change blocks conversational undo without mutating the site", async () => {
  const siteId = `undo-ai-interleaved-${crypto.randomUUID()}`;
  try {
    const initial = await getSite(siteId);
    const ai = await commitOperations({
      siteId,
      baseRevision: initial.draft.revision,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "AI 标题" }],
      summary: "AI 修改首屏",
      source: "ai",
    });
    assert.equal(ai.status, "applied");
    if (ai.status !== "applied") return;
    const manual = await commitOperations({
      siteId,
      baseRevision: ai.record.draft.revision,
      operations: [{ op: "set_text", target: "companyName", locale: "zh", value: "人工更新后的公司名" }],
      summary: "人工更新公司名",
      source: "manual",
    });
    assert.equal(manual.status, "applied");
    if (manual.status !== "applied") return;
    const before = JSON.stringify(manual.record);

    const undone = await undoLatestAiChange({ siteId, baseRevision: manual.record.draft.revision });

    assert.equal(undone.status, "unsafe");
    if (undone.status !== "unsafe") return;
    assert.equal(undone.targetChange.id, ai.changeSet.id);
    assert.deepEqual(undone.laterChanges.map((change) => change.id), [manual.changeSet.id]);
    assert.equal(JSON.stringify((await getSite(siteId)).draft), JSON.stringify(manual.record.draft));
    assert.equal(JSON.stringify(undone.record), before);
  } finally {
    await unlink(siteFile(siteId)).catch(() => undefined);
  }
});
