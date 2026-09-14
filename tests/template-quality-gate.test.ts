import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTemplateQuality, sectionRegistrationsFor } from "../lib/template-quality-gate.ts";

/** 造一份"够格入库"的最小模板：有首屏标题 + 一组集合槽，无演示残留。 */
const GOOD_HTML = `<!doctype html><html><head><title>工业服务</title></head><body>
<header><nav><a href="#about">关于</a></nav></header>
<main>
  <section id="hero"><h1 data-sitecraft-slot="hero.title">可靠交付</h1></section>
  <section id="features">
    <h2 data-sitecraft-slot="features.title">核心优势</h2>
    <ul>
      <li data-sitecraft-slot="features.items.0.title">全程追溯</li>
      <li data-sitecraft-slot="features.items.0.body">从来料到出货保留记录</li>
    </ul>
  </section>
  <section id="about"><p data-sitecraft-slot="about.body">公司简介</p></section>
</main></body></html>`;

test("evaluateTemplateQuality: 合格模板通过，并回报槽位清单", () => {
  const report = evaluateTemplateQuality({ html: GOOD_HTML, templateId: "demo" });
  assert.equal(report.passed, true, `不应有阻断项：${report.blockers.join("；")}`);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.slotTargets.includes("hero.title"));
  assert.ok(report.slotTargets.includes("features.items"));
  assert.ok(report.slotTargets.includes("about.body"));
});

test("evaluateTemplateQuality: 只有首屏标题没有集合槽 → 阻断（AI 无内容可填）", () => {
  const html = `<!doctype html><html><body><h1 data-sitecraft-slot="hero.title">标题</h1></body></html>`;
  const report = evaluateTemplateQuality({ html, templateId: "demo" });
  assert.equal(report.passed, false, "没有集合槽的模板不能入库——那是个静态页，不是模板");
  assert.ok(report.missingRequiredSlots.some((item) => item.includes("features.items")));
  assert.ok(report.issues.some((issue) => issue.code === "missing_required_slot"));
});

test("evaluateTemplateQuality: 连 hero.title 都没有 → 阻断", () => {
  const html = `<!doctype html><html><body><p data-sitecraft-slot="about.body">只有简介</p></body></html>`;
  const report = evaluateTemplateQuality({ html, templateId: "demo" });
  assert.equal(report.passed, false);
  assert.ok(report.missingRequiredSlots.includes("hero.title"));
});

test("evaluateTemplateQuality: 模板残留 lorem ipsum → 阻断", () => {
  const html = GOOD_HTML.replace("公司简介", "Lorem ipsum dolor sit amet");
  const report = evaluateTemplateQuality({ html, templateId: "demo" });
  assert.equal(report.passed, false);
  assert.ok(report.blockers.some((item) => item.includes("Lorem")), report.blockers.join("；"));
});

test("evaluateTemplateQuality: 模板作者人名残留 → 阻断", () => {
  const html = GOOD_HTML.replace("公司简介", "Designed by John Doe");
  const report = evaluateTemplateQuality({ html, templateId: "demo" });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((issue) => issue.code === "residual_demo_persona"));
});

test("evaluateTemplateQuality: 资产问题只警告、不阻断（换图是运营动作）", () => {
  // 命中 demo persona 之外，构造一个只触发资产规则、不触发其它 blocker 的模板
  const html = `<!doctype html><html><body>
    <h1 data-sitecraft-slot="hero.title">标题</h1>
    <img src="https://example.com/astronaut.png" alt="astronaut" />
    <ul><li data-sitecraft-slot="features.items.0.title">优势</li></ul>
  </body></html>`;
  const report = evaluateTemplateQuality({ html, templateId: "demo" });
  // 资产问题记为 warning；是否通过取决于有没有其它 blocker
  const assetIssues = report.issues.filter((issue) => issue.code.startsWith("asset_"));
  assert.ok(assetIssues.length > 0, "应识别出资产问题");
  assert.ok(assetIssues.every((issue) => issue.severity === "warning"));
  assert.equal(report.blockers.some((item) => item.includes("资产")), false, "资产问题不应出现在阻断项里");
});

test("sectionRegistrationsFor: 按节归组，集合节标 card_grid、文本节标 split_text_media", () => {
  const report = evaluateTemplateQuality({ html: GOOD_HTML, templateId: "demo" });
  const regs = sectionRegistrationsFor(report);
  const features = regs.find((reg) => reg.key === "features");
  const hero = regs.find((reg) => reg.key === "hero");
  assert.equal(features?.presentationRole, "card_grid");
  assert.equal(hero?.presentationRole, "split_text_media");
  // 运行时模板由通用引擎渲染，强制原生会让每个模板都 FAIL
  assert.ok(regs.every((reg) => reg.requiresNative === false));
  assert.deepEqual(features?.targets, ["features.title", "features.items"]);
});

test("evaluateTemplateQuality: 纯函数——同一输入两次结果一致，且不修改入参", () => {
  const html = GOOD_HTML;
  const before = html;
  const first = evaluateTemplateQuality({ html, templateId: "demo" });
  const second = evaluateTemplateQuality({ html, templateId: "demo" });
  assert.deepEqual(first.slotTargets, second.slotTargets);
  assert.equal(html, before, "不得修改传入的 HTML");
});
