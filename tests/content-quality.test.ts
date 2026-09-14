import assert from "node:assert/strict";
import test from "node:test";
import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import { getTemplateManifest } from "../lib/template-manifest.ts";
import { evaluateDraftQuality, qualityTier } from "../lib/content-quality.ts";
import { SLOT_MAX_LENGTH } from "../lib/template-slot-contract.ts";

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
  /**
   * 超长样例按**契约容量**构造（2026-09-12）。
   *
   * 这里原来是 26 个字的标题——当时手写的可读长度是 15，所以它算超长。
   * 那组手写数字已删除，长度只剩 `SLOT_MAX_LENGTH`（`hero.title` = 160）一个来源，
   * 26 字按新口径是合规的。要考"能不能定位到超长"就得真的越过契约线。
   */
  draft.content.hero.title.zh = "工".repeat(SLOT_MAX_LENGTH["hero.title"]! + 10);
  draft.content.hero.subtitle.zh = "Built for the next standard.";
  draft.content.about.body.zh = "我们拥有 ISO 9001 认证，服务 500 家客户。";
  draft.content.contact.address.en = "Address to be completed";

  const report = evaluateDraftQuality(draft, getTemplateManifest("forge")!);

  assert.ok(report.overLimitSlots.includes("hero.title"));
  assert.ok(report.languageMismatches.includes("hero.subtitle.zh"));
  assert.ok(report.placeholderTargets.includes("contact.address"));
  assert.ok(report.unverifiedFacts.some((fact) => fact.includes("ISO 9001")));
  assert.equal(report.publishable, false);
});

test("诚实占位不计入 missingSlots，lorem 仍按缺口处理（2026-09-08 修复）", () => {
  const manifest = getTemplateManifest("forge")!;
  // 除电话/地址外都填好，隔离出"仅剩诚实占位"的场景
  const filled = cloneDraft(defaultDraft);
  filled.companyName = "启衡工业";
  filled.content.hero.title.zh = "让精密制造更可靠";
  filled.content.about.body.zh = "启衡工业为新能源设备提供精密组件与联合工程服务。";
  filled.content.features.items = [{ id: "t", title: { zh: "全程追溯", en: "Traceability" }, body: { zh: "从来料到出货保留可核验记录。", en: "Verifiable records." } }];
  filled.content.services.items = [{ id: "e", title: { zh: "联合工程", en: "Joint engineering" }, body: { zh: "围绕应用边界共同完成设计验证。", en: "Validate designs." } }];
  filled.products = [{ sku: "QH-100", name: { zh: "高稳定连接组件", en: "Stable connector" }, summary: { zh: "面向高频振动工况。", en: "For high-vibration use." }, category: "精密组件", status: "published", imageColor: "#d7e7d1" }];
  filled.content.contact.title.zh = "把需求交给工程团队";
  filled.content.contact.body.zh = "提交图纸与目标交期，工程团队将在一个工作日内回复。";
  filled.content.contact.email = "engineering@qiheng.com";
  filled.content.contact.phone = "待补充";
  filled.content.contact.address.zh = "待补充";

  const report = evaluateDraftQuality(filled, manifest);
  // 诚实占位不落进硬缺口（否则 AI 说实话反而发布不了）
  assert.equal(report.missingSlots.includes("contact.phone"), false);
  assert.equal(report.missingSlots.includes("contact.address"), false);
  assert.ok(report.placeholderTargets.includes("contact.phone"));
  assert.ok(report.placeholderTargets.includes("contact.address"));
  // 占位仍扣分（提醒补齐），但不阻断到 0
  assert.ok(report.score > 0 && report.score < 100, `占位场景应扣分但非 0，实际 ${report.score}`);
  // 事实缺失不阻断发布（发布时隐藏该字段）
  assert.equal(report.publishable, true, "仅剩事实缺失时应可发布");

  // lorem ipsum 是伪造占位，不是诚实标注 → 按缺口处理
  const withLorem = cloneDraft(filled);
  withLorem.content.contact.phone = "lorem ipsum";
  const loremReport = evaluateDraftQuality(withLorem, manifest);
  assert.equal(loremReport.placeholderTargets.includes("contact.phone"), false);
  assert.ok(loremReport.fabricatedTargets.includes("contact.phone"), "lorem 属伪造内容");
  assert.equal(loremReport.publishable, false, "伪造内容必须阻断发布");
});

test("创意文案槽位上的\"待补充\"按缺口处理（AI 本该写得出来）", () => {
  const manifest = getTemplateManifest("forge")!;
  const draft = cloneDraft(defaultDraft);
  draft.content.hero.title.zh = "待补充";

  const report = evaluateDraftQuality(draft, manifest);
  assert.ok(report.missingSlots.includes("hero.title"), "首屏标题不是企业事实，写待补充=没干活");
  assert.equal(report.placeholderTargets.includes("hero.title"), false);
});

test("同一槽位不重复扣分（旧实现 missing + placeholder 双计）", () => {
  const manifest = getTemplateManifest("forge")!;
  const draft = cloneDraft(defaultDraft);
  // 空值槽：只计 missing 一次，不应再被 placeholder 计一次
  draft.content.contact.email = "";

  const report = evaluateDraftQuality(draft, manifest);
  assert.ok(report.missingSlots.includes("contact.email"));
  assert.equal(report.placeholderTargets.includes("contact.email"), false, "空值不该同时算占位");
});

// ===== 元说明与质量档位（2026-09-08 审计修复） =====

test("元说明句（把\"待补充\"写成访客可见的说明）属阻断项", () => {
  const manifest = getTemplateManifest("forge")!;
  const draft = cloneDraft(defaultDraft);
  draft.content.about.body.zh = "企业事实尚未提供的部分将明确标记为待补充。";

  const report = evaluateDraftQuality(draft, manifest);
  assert.ok(report.metaCommentaryTargets.includes("about.body"), "说明句应被识别为元说明");
  assert.equal(report.publishable, false, "元说明必须阻断发布");
});

test("纯标记（\"地址待补充\"）不算元说明，仍走事实缺失路径", () => {
  const manifest = getTemplateManifest("forge")!;
  const draft = cloneDraft(defaultDraft);
  draft.content.contact.address.zh = "地址待补充";

  const report = evaluateDraftQuality(draft, manifest);
  assert.equal(report.metaCommentaryTargets.includes("contact.address"), false);
  assert.ok(report.placeholderTargets.includes("contact.address"));
});

test("qualityTier: 有阻断项=blocked，无阻断项按分数分档", () => {
  const manifest = getTemplateManifest("forge")!;
  const base = cloneDraft(defaultDraft);
  base.companyName = "启衡工业";
  base.content.hero.title.zh = "让精密制造更可靠";
  base.content.about.body.zh = "启衡工业为新能源设备提供精密组件与联合工程服务。";
  base.content.features.items = [{ id: "t", title: { zh: "全程追溯", en: "T" }, body: { zh: "从来料到出货保留可核验记录。", en: "V" } }];
  base.content.services.items = [{ id: "e", title: { zh: "联合工程", en: "J" }, body: { zh: "围绕应用边界共同完成设计验证。", en: "V" } }];
  base.products = [{ sku: "Q", name: { zh: "组件", en: "C" }, summary: { zh: "说明", en: "S" }, category: "c", status: "published", imageColor: "#fff" }];
  base.content.contact.title.zh = "联系我们";
  base.content.contact.body.zh = "留下需求，我们尽快联系你。";
  base.content.contact.email = "a@qiheng.com";
  base.content.contact.phone = "13800000000";
  base.content.contact.address.zh = "上海市启衡路18号";

  const clean = evaluateDraftQuality(base, manifest);
  assert.equal(clean.publishable, true);
  assert.equal(qualityTier(clean), "direct", `干净草稿应为 direct，实际 ${qualityTier(clean)} (score=${clean.score})`);

  // 仅剩事实缺失 → 可发布，但分数下降进入 review
  const missingFact = cloneDraft(base);
  missingFact.content.contact.phone = "待补充";
  missingFact.content.contact.address.zh = "待补充";
  const review = evaluateDraftQuality(missingFact, manifest);
  assert.equal(review.publishable, true);
  assert.equal(qualityTier(review), "review", `实际 ${qualityTier(review)} (score=${review.score})`);

  // 有阻断项 → blocked
  const blocked = cloneDraft(base);
  blocked.content.hero.title.zh = "待补充";
  assert.equal(qualityTier(evaluateDraftQuality(blocked, manifest)), "blocked");
});

/**
 * 2026-09-10 回归：用户**主动隐藏**的板块不得被判为缺口。
 *
 * 生成链路早就是这个语义（`buildGenerationPlan` 把 hiddenSections 从待生成板块剔除），
 * 但质检器此前不认——用户隐藏「产品」后仍被要求填商品，
 * **发布被拦在一个他明确说不要的板块上**。
 * 此前未暴露，是因为默认草稿预置了 3 个演示商品把这一格填住了。
 */
test("隐藏的板块不算缺口，不阻断发布", () => {
  const manifest = getTemplateManifest("forge")!;
  const draft = cloneDraft(defaultDraft);
  draft.templateId = "forge";
  draft.products = []; // 没有商品……

  // ……且没有声明隐藏 → 应判缺口（这是真实的"该写没写"）
  const notHidden = evaluateDraftQuality(draft, manifest);
  assert.ok(notHidden.missingSlots.includes("products"), "未隐藏时产品为空应判缺口");

  // 声明隐藏后 → 不应再算缺口
  const hidden = cloneDraft(draft);
  hidden.hiddenSections = ["products"];
  const hiddenReport = evaluateDraftQuality(hidden, manifest);
  assert.ok(!hiddenReport.missingSlots.includes("products"), "已隐藏的板块不应再判缺口");
});
