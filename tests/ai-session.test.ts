import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft } from "../lib/site-document.ts";
import {
  _resetForTests,
  getOrCreateSession,
  isUnresolvableReferential,
  markRevisionDrift,
  MAX_RECENT_MESSAGES,
  pushAssistantMessage,
  pushUserMessage,
  recordAppliedChange,
  serializeSessionContext,
  SESSION_BLOCK_CHAR_LIMIT,
  SESSION_TTL_MS,
  sweepExpiredSessions,
  type ChatSession,
} from "../lib/ai-session.ts";

const BASE = { baseRevision: 1, templateId: "forge" };

function freshSession(now = 1000): ChatSession {
  return getOrCreateSession("site-a", "sess-1", { ...BASE, now });
}

test("returns the same session object for the same key", () => {
  _resetForTests();
  const a = getOrCreateSession("site-a", "sess-1", BASE);
  const b = getOrCreateSession("site-a", "sess-1", BASE);
  assert.equal(a, b);
});

test("isolates sessions by sessionId (multi-tab)", () => {
  _resetForTests();
  const a = getOrCreateSession("site-a", "tab-1", BASE);
  const b = getOrCreateSession("site-a", "tab-2", BASE);
  pushUserMessage(a, "改首屏");
  assert.equal(a.recentMessages.length, 1);
  assert.equal(b.recentMessages.length, 0);
});

test("truncates long messages and caps recent messages", () => {
  _resetForTests();
  const s = freshSession();
  pushUserMessage(s, "x".repeat(500));
  assert.equal(s.recentMessages[0].text.length, 300);
  for (let i = 0; i < MAX_RECENT_MESSAGES + 5; i += 1) pushUserMessage(s, `msg-${i}`);
  assert.ok(s.recentMessages.length <= MAX_RECENT_MESSAGES);
});

test("deduplicates identical repeated user messages (confirmation resend)", () => {
  _resetForTests();
  const s = freshSession();
  pushUserMessage(s, "删除第三个服务卡片");
  pushUserMessage(s, "删除第三个服务卡片");
  assert.equal(s.recentMessages.length, 1);
});

test("recordAppliedChange appends changeLog, updates fields, extracts facts, clears drift", () => {
  _resetForTests();
  const s = freshSession();
  const draft = structuredClone(defaultDraft);
  draft.companyName = "华辰精工";
  recordAppliedChange(s, {
    revision: 5,
    summary: "更新公司名",
    targets: ["companyName.zh"],
    draft,
  });
  assert.equal(s.changeLog.length, 1);
  assert.equal(s.lastAppliedRevision, 5);
  assert.deepEqual(s.lastAppliedTargets, ["companyName.zh"]);
  assert.equal(s.lastSummary, "更新公司名");
  assert.equal(s.facts.companyName, "华辰精工");
  assert.equal(s.revisionDrifted, false);
  // 漂移后再记录 → 清漂移
  markRevisionDrift(s);
  assert.equal(s.revisionDrifted, true);
  recordAppliedChange(s, { revision: 6, summary: "x", targets: [], draft });
  assert.equal(s.revisionDrifted, false);
});

test("caps changeLog at MAX_CHANGE_LOG", () => {
  _resetForTests();
  const s = freshSession();
  for (let i = 0; i < 10; i += 1) {
    recordAppliedChange(s, { revision: i + 1, summary: `s${i}`, targets: [], draft: structuredClone(defaultDraft) });
  }
  assert.equal(s.changeLog.length, 6);
});

test("detects revision drift when baseRevision differs from lastAppliedRevision", () => {
  _resetForTests();
  const now = 1000;
  const s = getOrCreateSession("site-a", "sess-1", { ...BASE, now });
  recordAppliedChange(s, { revision: 3, summary: "x", targets: [], draft: structuredClone(defaultDraft), now });
  const again = getOrCreateSession("site-a", "sess-1", { ...BASE, baseRevision: 5, now });
  assert.equal(again.revisionDrifted, true);
});

test("expires session after TTL and rebuilds fresh", () => {
  _resetForTests();
  const s = freshSession(1000);
  pushUserMessage(s, "hello");
  const rebuilt = getOrCreateSession("site-a", "sess-1", { ...BASE, now: 1000 + SESSION_TTL_MS + 1 });
  assert.equal(rebuilt.recentMessages.length, 0);
  assert.equal(rebuilt.lastAppliedRevision, null);
});

test("sweepExpiredSessions removes only expired ones", () => {
  _resetForTests();
  // 一个老会话（1000），一个新会话（TTL 内刚活跃）
  getOrCreateSession("site-a", "old", { ...BASE, now: 1000 });
  const fresh = getOrCreateSession("site-b", "new", { ...BASE, now: 1000 + SESSION_TTL_MS - 1000 });
  // 模拟 fresh 在 sweep 前仍活跃
  fresh.lastActiveAt = 1000 + SESSION_TTL_MS - 100;
  const removed = sweepExpiredSessions(1000 + SESSION_TTL_MS + 1);
  assert.equal(removed, 1);
  // 未过期的还在（getOrCreate 命中会更新 lastActiveAt，这里只验证存在且非重建）
  const stillThere = getOrCreateSession("site-b", "new", { ...BASE, now: 1000 + SESSION_TTL_MS + 1 });
  assert.equal(stillThere.siteId, "site-b");
  assert.equal(stillThere.sessionId, "new");
});

test("serializeSessionContext contains facts, changes, dialog and drift hint, within budget", () => {
  _resetForTests();
  const s = freshSession();
  pushUserMessage(s, "只把第二个服务标题改为智能产线集成");
  pushAssistantMessage(s, "已更新第二个服务标题。");
  const draft = structuredClone(defaultDraft);
  draft.companyName = "华辰精工";
  recordAppliedChange(s, { revision: 4, summary: "更新第二个服务标题为智能产线集成", targets: ["services.items.1.title.zh"], draft });
  markRevisionDrift(s);
  const block = serializeSessionContext(s);
  assert.match(block, /公司名=华辰精工/);
  assert.match(block, /v4 更新第二个服务标题/);
  assert.match(block, /用户：只把第二个服务标题/);
  assert.match(block, /版本提示/);
  assert.ok(block.length <= SESSION_BLOCK_CHAR_LIMIT);
});

test("isUnresolvableReferential: blocks referential request with no session history", () => {
  _resetForTests();
  const empty = getOrCreateSession("site-a", "sess-1", { ...BASE, now: 1000 });
  const res = isUnresolvableReferential("刚才改的标题再改短一点", empty, { hasLegacyContext: false, hasSelectedTarget: false });
  assert.equal(res, true);
});

test("isUnresolvableReferential: does not block when session has history", () => {
  _resetForTests();
  const s = getOrCreateSession("site-a", "sess-1", { ...BASE, now: 1000 });
  recordAppliedChange(s, { revision: 4, summary: "x", targets: ["hero.title.zh"], draft: structuredClone(defaultDraft), now: 1000 });
  const res = isUnresolvableReferential("刚才改的标题再改短一点", s, { hasLegacyContext: false, hasSelectedTarget: false });
  assert.equal(res, false);
});

test("isUnresolvableReferential: does not block when legacy context or selected target exists", () => {
  _resetForTests();
  const empty = getOrCreateSession("site-a", "sess-1", { ...BASE, now: 1000 });
  assert.equal(isUnresolvableReferential("刚才改的标题再改短一点", empty, { hasLegacyContext: true, hasSelectedTarget: false }), false);
  assert.equal(isUnresolvableReferential("刚才改的标题再改短一点", empty, { hasLegacyContext: false, hasSelectedTarget: true }), false);
});

test("isUnresolvableReferential: non-referential message is never blocked", () => {
  _resetForTests();
  const empty = getOrCreateSession("site-a", "sess-1", { ...BASE, now: 1000 });
  assert.equal(isUnresolvableReferential("把首屏标题改成可靠制造", empty, { hasLegacyContext: false, hasSelectedTarget: false }), false);
});
