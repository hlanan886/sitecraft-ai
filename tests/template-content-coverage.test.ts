import assert from "node:assert/strict";
import test from "node:test";

import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import {
  classifyDraftCoverage,
  detectTemplateDemoResidue,
} from "../lib/template-content-coverage.ts";
import { getTemplateManifest, type TemplateManifest } from "../lib/template-manifest.ts";

function completeDraft() {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  draft.content.about.body.zh = "启衡工业为新能源设备提供精密组件与联合工程服务。";
  draft.content.features.items = [{
    id: "traceability",
    title: { zh: "全程追溯", en: "Traceability" },
    body: { zh: "从来料到出货保留可核验记录。", en: "Verifiable records from intake to shipment." },
  }];
  draft.content.services.items = [{
    id: "engineering",
    title: { zh: "联合工程", en: "Joint engineering" },
    body: { zh: "围绕应用边界共同完成设计验证。", en: "Validate designs against application constraints." },
  }];
  draft.products = [{
    sku: "QH-100",
    name: { zh: "高稳定连接组件", en: "Stable connector assembly" },
    summary: { zh: "面向高频振动工况。", en: "For high-vibration environments." },
    category: "精密组件",
    status: "published",
    imageColor: "#d7e7d1",
  }];
  draft.content.contact.title.zh = "把需求交给工程团队";
  draft.content.contact.body.zh = "提交图纸与目标交期，工程团队将在一个工作日内回复。";
  draft.content.contact.email = "engineering@qiheng.example";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  return draft;
}

test("coverage separates user-filled, AI-filled and default pending targets", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);

  const defaultReport = classifyDraftCoverage({ draft: defaultDraft, manifest, appliedTargets: [] });
  assert.deepEqual(defaultReport.pendingTargets, manifest.slots.map((slot) => slot.target));
  assert.deepEqual(defaultReport.filledTargets, []);
  assert.deepEqual(defaultReport.aiFilledTargets, []);

  const report = classifyDraftCoverage({
    draft: completeDraft(),
    manifest,
    appliedTargets: ["hero.title.zh", "services.items.0.title.zh"],
  });
  assert.deepEqual(report.aiFilledTargets, ["hero.title", "services.items"]);
  assert.deepEqual(report.filledTargets, [
    "about.body",
    "features.items",
    "products",
    "contact.title",
    "contact.body",
    "contact.email",
    "contact.phone",
    "contact.address",
  ]);
  assert.deepEqual(report.pendingTargets, []);
  assert.deepEqual(report.residualDemoSlots, []);
  assert.deepEqual(report.unmappedRequiredTargets, []);
});

test("coverage marks empty, placeholder and lorem content as pending", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const draft = completeDraft();
  draft.content.about.body.zh = "";
  draft.content.features.items[0].body.zh = "Lorem ipsum dolor sit amet";
  draft.content.contact.body.zh = "待补充";

  const report = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  assert.deepEqual(report.pendingTargets, ["about.body", "features.items", "contact.body"]);
  assert.deepEqual(report.filledTargets, [
    "hero.title",
    "services.items",
    "products",
    "contact.title",
    "contact.email",
    "contact.phone",
    "contact.address",
  ]);
});

test("coverage resolves localized and string contact fields without conflating placeholders", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const draft = completeDraft();
  draft.content.contact.email = "sales@example.com";
  draft.content.contact.phone = "待补充";

  const report = classifyDraftCoverage({
    draft,
    manifest,
    appliedTargets: ["contact.title.zh", "contact.address.zh"],
  });
  assert.ok(report.aiFilledTargets.includes("contact.title"));
  assert.ok(report.aiFilledTargets.includes("contact.address"));
  assert.ok(report.pendingTargets.includes("contact.email"));
  assert.ok(report.pendingTargets.includes("contact.phone"));
  assert.equal(report.residualDemoSlots.includes("contact.email"), false);
  assert.equal(report.residualDemoSlots.includes("contact.phone"), true);
});

test("non-content slots never contribute to draft coverage", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const report = classifyDraftCoverage({ draft: completeDraft(), manifest, appliedTargets: [] });
  const classified = [
    ...report.filledTargets,
    ...report.aiFilledTargets,
    ...report.pendingTargets,
    ...report.residualDemoSlots,
    ...report.unmappedRequiredTargets,
  ];
  assert.equal(classified.some((target) => /(?:logo|image|formAction)/i.test(target)), false);
});

test("coverage and visible-text detection report template demo fingerprints", () => {
  const base = getTemplateManifest("forge");
  assert.ok(base);
  const manifest: TemplateManifest = {
    ...base,
    slots: base.slots.map((slot) => slot.target === "about.body"
      ? { ...slot, demoFingerprints: ["Acme Demo Company"] }
      : slot),
  };
  const draft = completeDraft();
  draft.content.about.body.zh = "Acme Demo Company has served every industry since 1999.";

  const report = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  assert.deepEqual(report.residualDemoSlots, ["about.body"]);
  assert.ok(report.pendingTargets.includes("about.body"));

  assert.deepEqual(detectTemplateDemoResidue({
    manifest,
    visibleTexts: {
      "hero.title": "让精密制造更可靠",
      "about.body": "About Acme Demo Company",
    },
  }), ["about.body"]);
});

test("coverage reports a required manifest target that cannot resolve to SiteDraft", () => {
  const base = getTemplateManifest("forge");
  assert.ok(base);
  const invalidManifest = {
    ...base,
    slots: [{
      target: "about.missing",
      selector: "#about",
      contentType: "text",
      required: true,
      maxLength: 400,
      demoFingerprints: [],
    }],
  } as unknown as TemplateManifest;

  const report = classifyDraftCoverage({ draft: completeDraft(), manifest: invalidManifest, appliedTargets: [] });
  assert.deepEqual(report.unmappedRequiredTargets, ["about.missing"]);
  assert.deepEqual(report.pendingTargets, []);
});
