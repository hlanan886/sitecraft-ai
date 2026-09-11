import assert from "node:assert/strict";
import test from "node:test";
import { checkDraftFacts, extractFacts } from "../lib/fact-check.ts";

test("extractFacts: finds certification, years, capacity, customers", () => {
  const text = "我们是 ISO 9001 认证企业，20 年制造经验，年产 10GW 组件，服务 500+ 客户。";
  const facts = extractFacts(text);
  const kinds = facts.map((f) => f.kind);
  assert.ok(kinds.includes("certification"), "应识别 ISO 9001");
  assert.ok(kinds.includes("years"), "应识别 20 年经验");
  assert.ok(kinds.includes("capacity"), "应识别年产 10GW");
  assert.ok(kinds.includes("customers"), "应识别 500+ 客户");
});

test("extractFacts: english variants", () => {
  const text = "ISO 9001 certified, 25 years of manufacturing experience, serving 300+ clients.";
  const facts = extractFacts(text);
  const kinds = facts.map((f) => f.kind);
  assert.ok(kinds.includes("certification"));
  assert.ok(kinds.includes("years"));
  assert.ok(kinds.includes("customers"));
});

test("checkDraftFacts: AI-fabricated certification flagged as unconfirmed", () => {
  // 参考信息没提 ISO → 草稿里的 ISO 9001 应标"待确认"
  const claims = checkDraftFacts(
    [{ source: "about.body", text: "我们是 ISO 9001 认证企业，20 年制造经验。" }],
    "华辰光伏专注光伏组件制造，面向欧美市场。",
  );
  assert.equal(claims.length, 2); // ISO + 年限（参考没提年限）
  assert.ok(claims.every((c) => !c.confirmed));
  assert.ok(claims.some((c) => c.raw.includes("ISO")));
});

test("checkDraftFacts: facts provided by user are confirmed", () => {
  const claims = checkDraftFacts(
    [{ source: "hero.subtitle", text: "25 年光伏制造经验，服务全球客户。" }],
    "华辰光伏有 25 年光伏制造经验，服务全球客户。",
  );
  // 年限 25 和客户数都在参考里 → 都 confirmed
  assert.equal(claims.length, 0);
});

test("checkDraftFacts: source is attributed", () => {
  const claims = checkDraftFacts(
    [{ source: "products.summary", text: "获 CE 认证的产品。" }],
    "", // 无参考 → 全部待确认
  );
  assert.ok(claims.some((c) => c.source === "products.summary"));
});

test("checkDraftFacts: empty reference flags everything as pending", () => {
  const claims = checkDraftFacts([{ source: "about.body", text: "ISO 14001 认证，月产能 5000 套。" }]);
  assert.equal(claims.length, 2);
  assert.ok(claims.every((c) => !c.confirmed));
});
