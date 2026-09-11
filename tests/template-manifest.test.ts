import assert from "node:assert/strict";
import test from "node:test";

import { buildTemplateRecommendations } from "../lib/generation-experience.ts";
import {
  getRequiredVisibleTargets,
  getTemplateManifest,
  isTemplateRecommendationEligible,
  supportsTemplateLocale,
} from "../lib/template-manifest.ts";
import { resolveDraftTarget } from "../lib/template-content-coverage.ts";
import { defaultDraft } from "../lib/site-document.ts";
import { evaluateTemplateSlotReport } from "../lib/template-slot-guard.ts";
import { getTemplateUiCopy } from "../lib/template-ui-copy.ts";

test("explicit template manifests keep the two healthy Next templates eligible in both locales", () => {
  for (const templateId of ["forge", "screwfast", "nextjs-landing", "shadcn-landing2"]) {
    const manifest = getTemplateManifest(templateId);
    assert.ok(manifest, templateId);
    assert.equal(supportsTemplateLocale(templateId, "zh"), true, templateId);
    assert.equal(supportsTemplateLocale(templateId, "en"), true, templateId);
    assert.equal(isTemplateRecommendationEligible(templateId), true, templateId);
    assert.deepEqual(getRequiredVisibleTargets(templateId), ["heroTitle"]);
  }

  const candidates = [
    { id: "nextjs-landing", category: "专业服务" },
    { id: "shadcn-landing2", category: "科技企业" },
  ];
  const recommended = buildTemplateRecommendations(
    candidates,
    { recommendedTemplateId: "nextjs-landing", summary: "developer platform" },
    { locale: "zh" },
  );
  assert.deepEqual(recommended.map((template) => template.id), ["nextjs-landing", "shadcn-landing2"]);
});

test("Forge and a Next template declare exact resolvable content bindings", () => {
  const expectedTargets = [
    "hero.title",
    "about.body",
    "features.items",
    "services.items",
    "products",
    "contact.title",
    "contact.body",
    "contact.email",
    "contact.phone",
    "contact.address",
  ];

  for (const templateId of ["forge", "nextjs-landing"]) {
    const manifest = getTemplateManifest(templateId);
    assert.ok(manifest, templateId);
    assert.deepEqual(manifest.slots.map((slot) => slot.target), expectedTargets, templateId);

    for (const slot of manifest.slots) {
      assert.ok(slot.selector.trim(), `${templateId}:${slot.target}:selector`);
      assert.ok(["text", "collection"].includes(slot.contentType), `${templateId}:${slot.target}:contentType`);
      assert.equal(typeof slot.required, "boolean", `${templateId}:${slot.target}:required`);
      assert.equal(typeof slot.maxLength, "number", `${templateId}:${slot.target}:maxLength`);
      assert.ok(slot.maxLength > 0, `${templateId}:${slot.target}:maxLength`);
      assert.ok(Array.isArray(slot.demoFingerprints), `${templateId}:${slot.target}:demoFingerprints`);
      assert.notEqual(resolveDraftTarget(defaultDraft, slot.target), undefined, `${templateId}:${slot.target}`);
    }
  }
});

test("template slots declare semantic metadata for provider constraints", () => {
  for (const templateId of ["forge", "screwfast", "nextjs-landing", "shadcn-landing2"]) {
    const manifest = getTemplateManifest(templateId);
    assert.ok(manifest, templateId);
    assert.equal(manifest.manifestVersion, 1, `${templateId}:manifestVersion`);
    for (const slot of manifest.slots) {
      assert.ok(slot.semanticType.trim(), `${templateId}:${slot.target}:semanticType`);
      assert.ok(slot.aliases.length > 0, `${templateId}:${slot.target}:aliases`);
      assert.deepEqual(slot.locales, ["zh", "en"], `${templateId}:${slot.target}:locales`);
      assert.equal(typeof slot.editable, "boolean", `${templateId}:${slot.target}:editable`);
    }
  }
});

test("visual assets and offline form actions are explicit non-content slots", () => {
  for (const templateId of ["forge", "nextjs-landing"]) {
    const manifest = getTemplateManifest(templateId);
    assert.ok(manifest, templateId);
    assert.equal(manifest.slots.some((slot) => /(?:logo|image|formAction)/i.test(slot.target)), false);
    assert.ok(manifest.nonContentSlots, `${templateId}:nonContentSlots`);
    assert.deepEqual(manifest.nonContentSlots.map((slot) => slot.target), [
      "brand.logo",
      "hero.image",
      "contact.formAction",
    ]);
    assert.ok(manifest.nonContentSlots.every((slot) => slot.coverage === "excluded"));

    const assetSlots = manifest.nonContentSlots.filter((slot) => slot.slotType === "asset");
    assert.deepEqual(assetSlots.map((slot) => slot.support), ["template-owned", "template-owned"]);
    const formAction = manifest.nonContentSlots.find((slot) => slot.target === "contact.formAction");
    assert.ok(formAction);
    assert.equal(formAction.slotType, "behavior");
    assert.equal(formAction.support, "unsupported");
    assert.equal("url" in formAction, false);
    assert.equal("value" in formAction, false);
  }
});

test("template UI copy covers navigation, FAQ, form and footer in Chinese and English", () => {
  const zh = getTemplateUiCopy("zh");
  assert.equal(zh.navigation.home, "首页");
  assert.equal(zh.faq.title, "常见问题");
  assert.equal(zh.form.labels.email, "邮箱");
  assert.equal(zh.form.placeholders.message, "请描述您的需求");
  assert.equal(zh.form.submit, "提交询盘");
  assert.equal(zh.footer.rightsReserved, "版权所有");

  const en = getTemplateUiCopy("en");
  assert.equal(en.navigation.home, "Home");
  assert.equal(en.faq.title, "Frequently Asked Questions");
  assert.equal(en.form.labels.email, "Email");
  assert.equal(en.form.placeholders.message, "Tell us about your needs");
  assert.equal(en.form.submit, "Send inquiry");
  assert.equal(en.footer.rightsReserved, "All rights reserved");
});

test("slot report rejects applied but invisible required text", () => {
  const report = evaluateTemplateSlotReport({
    requiredTargets: ["heroTitle"],
    appliedSlots: ["hero.title.zh"],
    visibleSlots: [],
  });

  assert.equal(report.incompatible, true);
  assert.deepEqual(report.missingSlots, ["heroTitle"]);
});

test("slot report accepts a required text fingerprint only when its mapped slot is visible", () => {
  const report = evaluateTemplateSlotReport({
    requiredTargets: ["heroTitle"],
    appliedSlots: ["hero.title.zh"],
    visibleSlots: ["hero.title.zh"],
  });

  assert.equal(report.incompatible, false);
  assert.deepEqual(report.missingSlots, []);
});
