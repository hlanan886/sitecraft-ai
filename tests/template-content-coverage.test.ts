import assert from "node:assert/strict";
import test from "node:test";

import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import {
  classifyDraftCoverage,
  detectTemplateDemoResidue,
  getTargetResolvers,
  registerTargetResolver,
  resolveDraftTarget,
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
  draft.content.contact.email = "engineering@qiheng.com";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  return draft;
}

test("coverage separates user-filled, AI-filled and default pending targets", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);

  const defaultReport = classifyDraftCoverage({ draft: defaultDraft, manifest, appliedTargets: [] });
  // 默认草稿：除联系方式自带缺口标记外，其余都是未完成
  assert.deepEqual(defaultReport.pendingTargets, [
    "hero.title",
    "about.body",
    "features.items",
    "services.items",
    "products",
    "contact.title",
    "contact.body",
  ]);
  assert.deepEqual(defaultReport.placeholderTargets, ["contact.email", "contact.phone", "contact.address"]);
  assert.deepEqual(defaultReport.fabricatedTargets, []);
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

test("coverage separates empty and demo residue from honest placeholders", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const draft = completeDraft();
  draft.content.about.body.zh = "";
  draft.content.features.items[0].body.zh = "Lorem ipsum dolor sit amet";
  draft.content.contact.phone = "待补充";

  const report = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  // 空值 → pending（该写没写）
  assert.deepEqual(report.pendingTargets, ["about.body"]);
  // lorem ipsum → 伪造内容（比缺失更糟，必须阻断发布）
  assert.deepEqual(report.fabricatedTargets, ["features.items"]);
  // 企业事实类槽位上的诚实标记 → 单列（2026-09-08：此前与 lorem 混在一起扣分，
  // 导致"AI 如实标注缺口"反而发布不了）
  assert.deepEqual(report.placeholderTargets, ["contact.phone"]);
  assert.deepEqual(report.filledTargets, [
    "hero.title",
    "services.items",
    "products",
    "contact.title",
    "contact.body",
    "contact.email",
    "contact.address",
  ]);
});

test("coverage keeps partial placeholders as content and placeholder-only values separate", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const draft = completeDraft();
  draft.content.about.body.zh = "企业事实尚未提供的部分将明确标记为待补充。";
  draft.content.contact.address.zh = "地址待补充";

  const report = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  // 局部带占位（有实义内容）→ 仍是内容，不判缺口
  assert.equal(report.placeholderTargets.includes("about.body"), false);
  assert.equal(report.pendingTargets.includes("about.body"), false);
  // 整条就是占位 → placeholderTargets
  assert.ok(report.placeholderTargets.includes("contact.address"));
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
  // sales@example.com 是示例域名 → 伪造内容（比缺失更糟）
  assert.ok(report.fabricatedTargets.includes("contact.email"));
  assert.ok(report.placeholderTargets.includes("contact.phone"));
  assert.equal(report.residualDemoSlots.includes("contact.email"), false);
  /**
   * 2026-09-12 改：`contact.phone` **不再**同时出现在 `residualDemoSlots` 里。
   *
   * 原先它两边都进：一边说它是"模板演示残留"（硬缺口），一边说它是"AI 如实标注的缺口"
   * （可发布）。同一份报告自相矛盾，而 `coverageForRecord` 取前者算 `missingSections`，
   * 于是**如实留"待补充"的站永远发布不了、也永远补不完**（AI 本就不该编造电话）。
   * 真机实测：新建站的 `partial` 卡死在 `contact`。
   *
   * 函数自己的注释早就写明「诚实占位必须早于 demo 残留判定」，代码没照做。
   * 现在顺序与注释一致：诚实占位先返回，不会再落进 demo 残留。
   */
  assert.equal(report.residualDemoSlots.includes("contact.phone"), false);
});

test("non-content slots never contribute to draft coverage", () => {
  const manifest = getTemplateManifest("forge");
  assert.ok(manifest);
  const report = classifyDraftCoverage({ draft: completeDraft(), manifest, appliedTargets: [] });
  const classified = [
    ...report.filledTargets,
    ...report.aiFilledTargets,
    ...report.pendingTargets,
    ...report.placeholderTargets,
    ...report.fabricatedTargets,
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

// ===== 槽位词表注册表（2026-09-09 泛化） =====

test("槽位解析器注册表：新增槽位无需改核心文件", () => {
  const before = getTargetResolvers().size;
  registerTargetResolver("certificates.items", (draft) => [`证书数：${draft.products.length}`]);
  const after = getTargetResolvers();

  assert.equal(after.size, before + 1, "注册后解析器数量应 +1");
  const draft = cloneDraft(defaultDraft);
  assert.deepEqual(resolveDraftTarget(draft, "certificates.items"), [`证书数：${draft.products.length}`]);
});

test("未注册的槽位返回 undefined（不抛错）", () => {
  const draft = cloneDraft(defaultDraft);
  assert.equal(resolveDraftTarget(draft, "unknown.section"), undefined);
});

test("内置槽位解析器覆盖全部 TemplateContentTarget", () => {
  const manifest = getTemplateManifest("forge")!;
  const resolvers = getTargetResolvers();
  const draft = cloneDraft(defaultDraft);
  for (const slot of manifest.slots) {
    assert.ok(resolvers.has(slot.target), `槽位 ${slot.target} 缺少解析器`);
    assert.ok(resolveDraftTarget(draft, slot.target) !== undefined, `${slot.target} 解析失败`);
  }
});
