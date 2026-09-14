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

// ---------------------------------------------------------------------------
// 2026-09-10：方向 2「以用户素材为准」暴露的三处比对缺陷
// ---------------------------------------------------------------------------

test("extractFacts: 四位年份不被截断（此前 \d{1,3} 把 2008年 抽成 008年）", () => {
  const facts = extractFacts("鼎力工业服务成立于2008年，位于江苏无锡。");
  const years = facts.find((f) => f.kind === "years");
  assert.ok(years, "应识别出年份");
  assert.equal(years.raw, "2008年");
});

test("checkDraftFacts: 素材写 iso9001、草稿写 ISO 9001 也算已确认（空格/大小写不敏感）", () => {
  const claims = checkDraftFacts(
    [{ source: "features.items.0.body.zh", text: "公司通过 ISO 9001 与 CE 认证。" }],
    "鼎力工业服务通过 iso9001 与 ce 认证。",
  );
  assert.equal(claims.length, 0, `应全部确认，实际待确认：${claims.map((c) => c.raw).join("、")}`);
});

test("checkDraftFacts: 数字类声明按数字比对，不因上下文措辞不同而误报", () => {
  // 素材："服务过 120 家"，草稿："服务 120 家" —— 旧实现整句 includes 会误报
  const claims = checkDraftFacts(
    [{ source: "features.items.1.body.zh", text: "已服务 120 家制造企业。" }],
    "鼎力工业服务已服务过 120 家制造企业。",
  );
  assert.equal(claims.length, 0);
});

test("checkDraftFacts: 数字必须是完整数字，120 不得被 1200 误确认", () => {
  const claims = checkDraftFacts(
    [{ source: "features.items.1.body.zh", text: "已服务 120 家客户。" }],
    "已服务 1200 家客户。",
  );
  assert.equal(claims.length, 1, "120 不应匹配到 1200 里");
  assert.equal(claims[0].kind, "customers");
});

test("checkDraftFacts: 用户素材没有的数字仍然报待确认（不因放宽而漏报）", () => {
  const claims = checkDraftFacts(
    [{ source: "about.body.zh", text: "我们成立于2008年，年产能 2GW。" }],
    "鼎力工业服务成立于2008年。",
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0].kind, "capacity");
});
