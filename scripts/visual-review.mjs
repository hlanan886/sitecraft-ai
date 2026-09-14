#!/usr/bin/env node
/**
 * 视觉复审流水线（供开发与 Codex 截图验收共用）
 *
 * 目的：让"消除卡片 AI 味、围绕模板原生建站"可被机器 + 视觉双重验收，而不是口头约定。
 *
 * 用法：
 *   node scripts/visual-review.mjs                      # 渲染 screwfast+鑫力草稿，截首屏+features 整区
 *   node scripts/visual-review.mjs <siteId>             # 用指定站点草稿
 *   node scripts/visual-review.mjs <siteId> <templateId>
 *
 * 产物：成品展示/_review-<templateId>-<视角>.jpg
 *   - hero    首屏
 *   - features 原生优势区（滚动到该 section）
 *   - full    整页长图
 *
 * 之后用 Codex 选择性复审（本会话已验证可行）：
 *   codex exec --sandbox read-only "看图评估…"
 *
 * DOM 级断言在同目录 verify-native-render.mjs（无卡片墙/无登录/评分残留/标题中文）。
 */
import { chromium } from "playwright";
import fs from "node:fs";

const SITE_ID = process.argv[2] || "73d3fe9b-9ee2-4258-9149-100dee9b575f"; // 惠州鑫力（screwfast）
const TEMPLATE_ID = process.argv[3] || "screwfast";
const OUT_DIR = "成品展示";

function loadDraft(siteId) {
  const f = `.sitecraft-data/sites/${siteId}.json`;
  if (!fs.existsSync(f)) {
    console.error(`找不到站点文件 ${f}。`);
    process.exit(1);
  }
  const rec = JSON.parse(fs.readFileSync(f, "utf8"));
  const draft = rec.draft || rec;
  if (draft.templateId !== TEMPLATE_ID) {
    console.warn(`注意：站点 templateId=${draft.templateId}，与 ${TEMPLATE_ID} 不同（仍按站点自身渲染）。`);
  }
  return draft;
}

const draft = loadDraft(SITE_ID);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERR(可忽略的模板脚本):", e.message.slice(0, 100)));
await p.goto(`http://localhost:3000/api/templates/${draft.templateId}/preview?v=export`, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.evaluate((d) => {
  window.postMessage({ type: "sitecraft:content", templateId: d.templateId, draft: d, locale: d.locale || "zh", expectedTargets: [], variant: "published" }, "*");
}, draft);
await p.waitForTimeout(3500);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const shot = (name) => p.screenshot({ path: `${OUT_DIR}/_review-${draft.templateId}-${name}.jpg`, type: "jpeg", quality: 75 });

// 1) 首屏
await shot("hero");

// 2) features 原生区（screwfast = 含 grid-cols-3 + gap-x-5 + 图的 section）
const hasNativeFeatures = await p.evaluate(() => {
  return Array.from(document.querySelectorAll("main section")).some(
    (s) => /grid-cols-3/.test(s.innerHTML || "") && /gap-x-5/.test(s.innerHTML || "") && s.querySelector("img"),
  );
});
if (hasNativeFeatures) {
  await p.evaluate(() => {
    // 滚到原生区"标题"（左栏 h2），使标题+icon 行都进视口——滚到 section 顶会被整宽图横幅占满
    const s = Array.from(document.querySelectorAll("main section")).find(
      (x) => /grid-cols-3/.test(x.innerHTML || "") && /gap-x-5/.test(x.innerHTML || "") && x.querySelector("img"),
    );
    if (!s) return;
    const leftCol = Array.from(s.querySelectorAll("div")).find((d) => /col-span-1/.test(String(d.className || "")));
    const anchor = leftCol?.querySelector("h2") || s.querySelector("h2") || s;
    anchor.scrollIntoView({ block: "start" });
  });
  await p.waitForTimeout(800);
}
await shot("features");

// 3) 整页
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(300);
await shot("full");

await b.close();
console.log(`✅ 已生成 ${OUT_DIR}/_review-${draft.templateId}-{hero,features,full}.jpg`);

// P1.3：输出结构忠实度 JSON（供产检测/门禁消费，与截图配套）
try {
  const { evaluateFidelity } = await import("../lib/template-fidelity-guard.ts");
  const { getTemplatePresentation } = await import("../lib/template-manifest.ts");
  const html = await fetch(`http://localhost:3000/api/templates/${draft.templateId}/preview?v=export`).then((r) => r.text());
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const sections = ["about", "features", "services", "products", "contact"];
  const generatedSections = sections.filter((s) => html.includes(`data-sitecraft-generated-content="${s}"`));
  const report = evaluateFidelity({
    visibleText: text,
    sections,
    generatedSections,
    appliedSections: sections.filter((s) => !generatedSections.includes(s)),
    html,
    // 接线（2026-09-09）：manifest 的 nativeFallbackHost 显式声明此前从未被消费，
    // 导致"声明由通用承载"的节仍被 L3 判为结构违规（误报）。
    presentation: getTemplatePresentation(draft.templateId),
  });
  const outFile = `${OUT_DIR}/_review-${draft.templateId}-fidelity.json`;
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`📋 fidelity: ${outFile}`);
  console.log(`   passed=${report.passed} | 残留=${report.residualBlocks.length} | 资产=${report.assetIssues.length} | 结构违规=${report.structure.filter((s) => s.violation).length}`);
  for (const blocker of report.blockers) console.log(`   ❌ ${blocker}`);
} catch (error) {
  console.warn("fidelity 检测跳过（需要 dev server 与 TS 运行时）:", error instanceof Error ? error.message.slice(0, 80) : error);
}

console.log("下一步：用 Codex 视觉复审，例如：");
console.log(`  codex exec --sandbox read-only "看图评估 ${OUT_DIR}/_review-${draft.templateId}-hero.jpg 与 -features.jpg …"`);
