import assert from "node:assert/strict";
import test from "node:test";

import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import { deriveSeoMetadata } from "../lib/seo-metadata.ts";

test("deriveSeoMetadata: 标题含公司名与首屏主张", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  const seo = deriveSeoMetadata(draft, "zh");
  assert.ok(seo.title.includes("启衡工业"));
  assert.ok(seo.title.includes("让精密制造更可靠"));
});

test("deriveSeoMetadata: 描述优先用副标题", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.subtitle.zh = "为新能源设备提供精密组件与联合工程服务。";
  const seo = deriveSeoMetadata(draft, "zh");
  assert.equal(seo.description, "为新能源设备提供精密组件与联合工程服务。");
});

test("deriveSeoMetadata: 占位值不得进入 SEO（搜索摘要里不能出现「待补充」）", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.subtitle.zh = "待补充";
  draft.content.about.body.zh = "启衡工业专注精密组件。";
  const seo = deriveSeoMetadata(draft, "zh");
  assert.equal(seo.description.includes("待补充"), false);
  assert.equal(seo.description, "启衡工业专注精密组件。");
});

test("deriveSeoMetadata: 示例域名/伪造内容同样剔除", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.subtitle.zh = "hello@example.com";
  draft.content.about.body.zh = "真实简介内容。";
  const seo = deriveSeoMetadata(draft, "zh");
  assert.equal(seo.description, "真实简介内容。");
});

test("deriveSeoMetadata: 超长截断且不破坏结构", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  // 清空副标题，让描述回落到 about.body（否则副标题优先）
  draft.content.hero.subtitle = { zh: "", en: "" };
  draft.content.about.body.zh = "精".repeat(500);
  const seo = deriveSeoMetadata(draft, "zh");
  assert.ok(Array.from(seo.description).length <= 160, `描述应截断到 160 字内，实际 ${Array.from(seo.description).length}`);
  assert.ok(seo.description.endsWith("…"));
});

test("deriveSeoMetadata: 按语言取对应文案", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "Qiheng Industrial";
  draft.content.hero.title = { zh: "让精密制造更可靠", en: "Precision manufacturing, made reliable" };
  const zh = deriveSeoMetadata(draft, "zh");
  const en = deriveSeoMetadata(draft, "en");
  assert.ok(zh.title.includes("让精密制造更可靠"));
  assert.ok(en.title.includes("Precision manufacturing, made reliable"));
});

test("deriveSeoMetadata: 全空草稿兜底不崩", () => {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "";
  draft.siteName = "";
  draft.content.hero.title = { zh: "", en: "" };
  draft.content.hero.subtitle = { zh: "", en: "" };
  draft.content.about.body = { zh: "", en: "" };
  draft.goal = "";
  const seo = deriveSeoMetadata(draft, "zh");
  assert.ok(seo.title.length > 0, "标题必须有兜底");
  assert.ok(seo.description.length > 0, "描述必须有兜底");
});
