import assert from "node:assert/strict";
import test from "node:test";
import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import { getTemplateManifest } from "../lib/template-manifest.ts";
import { evaluateDraftQuality } from "../lib/content-quality.ts";

test("evaluateDraftQuality rejects a draft without hero and contact entry", () => {
  const draft = cloneDraft(defaultDraft);
  draft.content.hero.title.zh = "待补充";
  draft.content.contact.email = "";

  const report = evaluateDraftQuality(draft, getTemplateManifest("forge")!);

  assert.equal(report.publishable, false);
  assert.ok(report.missingSlots.includes("hero.title"));
  assert.ok(report.missingSlots.includes("contact.email"));
});

test("evaluateDraftQuality locates copy limits, placeholders, language drift and unverified facts", () => {
  const draft = cloneDraft(defaultDraft);
  draft.content.hero.title.zh = "这是一个明显超过首屏标题限制的工业自动化设备企业宣传标题";
  draft.content.hero.subtitle.zh = "Built for the next standard.";
  draft.content.about.body.zh = "我们拥有 ISO 9001 认证，服务 500 家客户。";
  draft.content.contact.address.en = "Address to be completed";

  const report = evaluateDraftQuality(draft, getTemplateManifest("forge")!);

  assert.ok(report.overLimitSlots.includes("hero.title"));
  assert.ok(report.languageMismatches.includes("hero.subtitle.zh"));
  assert.ok(report.placeholderHits.includes("contact.address"));
  assert.ok(report.unverifiedFacts.some((fact) => fact.includes("ISO 9001")));
  assert.equal(report.publishable, false);
});
