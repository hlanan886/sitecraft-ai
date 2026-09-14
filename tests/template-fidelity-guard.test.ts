import assert from "node:assert/strict";
import test from "node:test";

import {
  checkStructure,
  detectAssetIssues,
  detectResidualBlocks,
  evaluateFidelity,
  manifestHostsFor,
  extractImageAssets,
  getResidualPatterns,
  getSectionType,
  getSectionTypes,
  registerResidualPattern,
  registerSectionType,
  resetResidualPatterns,
  resetSectionRegistry,
} from "../lib/template-fidelity-guard.ts";

// ===== 注册表：内置节 =====

test("内置 corporate 五节已注册", () => {
  const keys = getSectionTypes().map((s) => s.key).sort();
  assert.deepEqual(keys, ["about", "contact", "features", "products", "services"]);
});

test("features/services 要求原生结构，about/products/contact 不要求", () => {
  assert.equal(getSectionType("features")?.requiresNative, true);
  assert.equal(getSectionType("services")?.requiresNative, true);
  assert.equal(getSectionType("about")?.requiresNative, false);
  assert.equal(getSectionType("products")?.requiresNative, false);
  assert.equal(getSectionType("contact")?.requiresNative, false);
});

// ===== 可扩展性（用户后续丰富模板的关键） =====

test("注册新行业节（资质墙）后即被检测纳入", () => {
  registerSectionType({
    key: "certificate",
    label: "资质证书",
    requiresNative: true,
    targets: ["certificate.items"],
    presentationRole: "logo_strip",
  });
  const reg = getSectionType("certificate");
  assert.ok(reg);
  assert.equal(reg.label, "资质证书");
  assert.equal(reg.requiresNative, true);

  // 结构检测立即认可新节
  const checks = checkStructure({
    sections: ["certificate"],
    generatedSections: ["certificate"],
    appliedSections: [],
  });
  assert.equal(checks[0].violation, true, "新节要求原生却走兜底 → 应判违规");

  // 清理，避免污染其他测试（reset 恢复内置节，不清空）
  resetSectionRegistry();
  assert.equal(getSectionTypes().length, 5, "reset 后应恢复 5 个内置节");
  assert.equal(getSectionType("certificate"), undefined, "自定义节应被清除");
});

test("注册自定义残留特征后即可检测", () => {
  const before = getResidualPatterns().length;
  registerResidualPattern({
    key: "custom_demo_block",
    test: (t) => /某某模板演示区/.test(t),
    severity: "high",
    description: "自定义演示区残留",
  });
  assert.equal(getResidualPatterns().length, before + 1);

  const findings = detectResidualBlocks("这是某某模板演示区的内容");
  assert.ok(findings.some((f) => f.patternKey === "custom_demo_block"));

  resetResidualPatterns();
});

// ===== L2：残留区块检测（实测样本） =====

test("detectResidualBlocks: 检出英文 SaaS 看板（华曜站实测样本）", () => {
  const findings = detectResidualBlocks([
    "$45,385",
    "5,897 Products this week",
    "6,438 Visitors this week",
  ]);
  assert.ok(findings.some((f) => f.patternKey === "saas_analytics_dashboard"));
  assert.equal(findings.find((f) => f.patternKey === "saas_analytics_dashboard")?.severity, "high");
});

test("detectResidualBlocks: 检出 Lorem ipsum 与人名残留", () => {
  const findings = detectResidualBlocks(["Lorem ipsum dolor sit amet", "I'm Ryan Fitzgerald"]);
  const keys = findings.map((f) => f.patternKey);
  assert.ok(keys.includes("lorem_ipsum"));
  assert.ok(keys.includes("demo_persona"));
});

test("detectResidualBlocks: 干净中文内容无 high 级残留", () => {
  const findings = detectResidualBlocks(["高效光伏组件", "分布式电站EPC", "并网逆变器"]);
  assert.equal(findings.filter((f) => f.severity === "high").length, 0);
});

test("detectResidualBlocks: 空输入安全", () => {
  assert.deepEqual(detectResidualBlocks(""), []);
  assert.deepEqual(detectResidualBlocks([]), []);
});

// ===== L3：结构判定 =====

test("checkStructure: 要求原生的节走 generated → 违规", () => {
  const checks = checkStructure({
    sections: ["features"],
    generatedSections: ["features"],
    appliedSections: [],
  });
  assert.equal(checks[0].verdict, "generated");
  assert.equal(checks[0].violation, true);
});

test("checkStructure: 要求原生的节落在原生结构 → 合规", () => {
  const checks = checkStructure({
    sections: ["features"],
    generatedSections: [],
    appliedSections: ["features"],
  });
  assert.equal(checks[0].verdict, "native");
  assert.equal(checks[0].violation, false);
});

test("checkStructure: 不要求原生的节走 generated → 不违规（如 products 由通用网格承载）", () => {
  const checks = checkStructure({
    sections: ["products"],
    generatedSections: ["products"],
    appliedSections: [],
  });
  assert.equal(checks[0].verdict, "generated");
  assert.equal(checks[0].violation, false, "products 不要求原生，走通用承载是设计内行为");
});

test("checkStructure: 无内容的节判 missing", () => {
  const checks = checkStructure({
    sections: ["about"],
    generatedSections: [],
    appliedSections: [],
  });
  assert.equal(checks[0].verdict, "missing");
});

// ===== L2b：图片资产检测（视觉发现固化） =====

test("extractImageAssets: 提取 img 的 src 与 alt", () => {
  const html = '<img src="/a.jpg" alt="产品图"><img src="/b.png" alt="">';
  const assets = extractImageAssets(html);
  assert.ok(assets.includes("/a.jpg"));
  assert.ok(assets.includes("产品图"));
  assert.ok(assets.includes("/b.png"));
});

test("detectAssetIssues: 检出宇航员图（华曜/华固实测样本）", () => {
  const html = '<img src="/_astro/hero.avif" alt="A floating astronaut in a space suit">';
  const findings = detectAssetIssues(html);
  assert.ok(findings.some((f) => f.patternKey === "hero_asset_business_mismatch"));
  assert.equal(findings.find((f) => f.patternKey === "hero_asset_business_mismatch")?.severity, "high");
});

test("detectAssetIssues: 检出模板 demo 图", () => {
  const html = '<img src="/_astro/hero-image.abc.avif" alt="product box">';
  const findings = detectAssetIssues(html);
  assert.ok(findings.some((f) => f.patternKey === "hero_asset_demo_placeholder"));
});

test("detectAssetIssues: 真实产品图不误报", () => {
  const html = '<img src="/uploads/cnc-part-1.jpg" alt="CNC精密加工件">';
  assert.deepEqual(detectAssetIssues(html), []);
});

test("evaluateFidelity: 资产 high 级问题 → 不通过", () => {
  const report = evaluateFidelity({
    visibleText: ["高效光伏组件"],
    sections: ["features"],
    generatedSections: [],
    appliedSections: ["features"],
    html: '<img src="/hero.avif" alt="A floating astronaut in a space suit">',
  });
  assert.equal(report.passed, false);
  assert.ok(report.blockers.some((b) => b.includes("hero_asset_business_mismatch")));
});

// ===== 汇总报告 =====

test("evaluateFidelity: high 级残留 → 不通过", () => {
  const report = evaluateFidelity({
    visibleText: ["$45,385", "6,438 Visitors this week"],
    sections: ["features"],
    generatedSections: [],
    appliedSections: ["features"],
  });
  assert.equal(report.passed, false);
  assert.ok(report.blockers.some((b) => b.includes("saas_analytics_dashboard")));
});

test("evaluateFidelity: 结构违规 → 不通过", () => {
  const report = evaluateFidelity({
    visibleText: ["高效组件"],
    sections: ["features"],
    generatedSections: ["features"],
    appliedSections: [],
  });
  assert.equal(report.passed, false);
  assert.ok(report.blockers.some((b) => b.includes("features")));
});

test("evaluateFidelity: 干净产物 → 通过", () => {
  const report = evaluateFidelity({
    visibleText: ["高效光伏组件", "分布式电站EPC"],
    sections: ["features", "products"],
    generatedSections: ["products"],
    appliedSections: ["features"],
  });
  assert.equal(report.passed, true);
  assert.deepEqual(report.blockers, []);
});

// ===== manifest 显式承载声明接线（2026-09-09） =====

test("manifestHostsFor: 从 presentation 提取显式声明", () => {
  const hosts = manifestHostsFor([
    { presentationSlot: "features" },
    { presentationSlot: "services", nativeFallbackHost: "generated" },
    { presentationSlot: "contact", nativeFallbackHost: "native" },
  ]);
  assert.deepEqual(hosts, { services: "generated", contact: "native" });
});

test("接线后：声明 generated 的节走兜底不再误报结构违规", () => {
  const base = {
    visibleText: ["正常内容"],
    sections: ["services"],
    generatedSections: ["services"],
    appliedSections: [],
  };
  // 接线前：services 在注册表里 requiresNative=true → 误判违规
  const withoutDeclaration = evaluateFidelity(base);
  assert.equal(withoutDeclaration.structure[0].violation, true, "未声明时应按注册表判违规");

  // 接线后：manifest 声明该节由通用承载 = 设计内行为 → 不违规
  const withDeclaration = evaluateFidelity({ ...base, presentation: [{ presentationSlot: "services", nativeFallbackHost: "generated" }] });
  assert.equal(withDeclaration.structure[0].violation, false, "声明 generated 后不应违规");
  assert.equal(withDeclaration.structure[0].requiresNative, false);
});

test("接线后：声明 native 的节走兜底仍判违规（真缺陷）", () => {
  const report = evaluateFidelity({
    visibleText: ["正常内容"],
    sections: ["products"],
    generatedSections: ["products"],
    appliedSections: [],
    presentation: [{ presentationSlot: "products", nativeFallbackHost: "native" }],
  });
  assert.equal(report.structure[0].requiresNative, true);
  assert.equal(report.structure[0].violation, true, "声明 native 却走兜底 = 真缺陷");
});

test("显式 manifestHosts 优先于 presentation 派生", () => {
  const report = evaluateFidelity({
    visibleText: ["正常内容"],
    sections: ["services"],
    generatedSections: ["services"],
    appliedSections: [],
    manifestHosts: { services: "native" },
    presentation: [{ presentationSlot: "services", nativeFallbackHost: "generated" }],
  });
  assert.equal(report.structure[0].violation, true, "显式传入应优先");
});
