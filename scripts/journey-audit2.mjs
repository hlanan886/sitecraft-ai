#!/usr/bin/env node
/**
 * AI 建站完整旅程走查 · 第二段（2026-09-09）。
 *
 * 第一段（journey-audit.mjs）已验证：模糊输入 → 追问页。
 * 本段用**信息充分**的指令直通：确认 → 生成 → 预览 → 工作台 → 直接编辑，逐屏截图。
 *
 * 用法：node --experimental-strip-types scripts/journey-audit2.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(root, ".sitecraft-data", "journey2");
mkdirSync(OUT, { recursive: true });

const PROMPT = "我是华辰光伏，做组件出口的，客户在欧美，要专业可靠的企业官网";

const findings = [];
const record = (step, level, note, evidence) => {
  findings.push({ step, level, note, evidence });
  console.log(`[${level}] ${step} — ${note}${evidence ? ` :: ${evidence}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: false });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e).slice(0, 200)));
page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 110)} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("localhost")) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`); });

const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false }); };

try {
  await page.goto(BASE + "/generate", { waitUntil: "networkidle" });
  await page.fill("textarea", PROMPT);
  await page.click("button:has-text('开始理解需求')");
  record("建站页", "info", "提交充分指令", PROMPT);

  // 等待进入确认页（或追问页）
  await page.waitForFunction(() => /STEP 02|确认|推荐|追问|还差/.test(document.body.innerText), { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot("01-after-analyze");

  const step1 = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 900));
  record("理解结果", "info", "页面内容", step1.slice(0, 400));

  // 若仍在追问页，填入补充信息继续
  if (/还差|再告诉我|追问/.test(step1)) {
    await page.fill("textarea", "公司名华辰光伏，客户是欧美采购商，专业可靠");
    await page.click("button:has-text('继续理解')");
    await page.waitForTimeout(6000);
    await shot("02-after-clarify");
  }

  // 确认页：记录推荐的模板与板块
  const confirmFacts = await page.evaluate(() => {
    const text = document.body.innerText;
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean);
    return { text: text.replace(/\n+/g, " | ").slice(0, 1000), buttons: btns.slice(0, 15) };
  });
  record("确认页", "info", "推荐与按钮", JSON.stringify(confirmFacts).slice(0, 600));
  await shot("03-confirm");

  // 点击执行生成
  const execBtn = await page.$("button:has-text('生成'), button:has-text('执行'), button:has-text('开始生成'), button:has-text('确认')");
  if (execBtn) {
    await execBtn.click();
    record("生成", "info", "已触发生成");
  } else {
    record("生成", "bug", "未找到生成按钮", JSON.stringify(confirmFacts.buttons));
  }

  // 等待生成完成（进入工作台或显示完成）
  await page.waitForFunction(() => /工作台|完成|已生成|进入/.test(document.body.innerText), { timeout: 300_000 }).catch(() => null);
  await page.waitForTimeout(3000);
  await shot("04-generated");

  const genText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 1200));
  record("生成完成", "info", "结果页", genText.slice(0, 500));

  // 进入工作台
  if (page.url().includes("/workspace")) {
    record("工作台", "info", "已自动进入", page.url());
  } else {
    const goBtn = await page.$("button:has-text('进入工作台')");
    if (goBtn) { await goBtn.click(); await page.waitForTimeout(5000); }
  }
  await page.waitForTimeout(4000);
  await shot("05-workspace");
  record("工作台", "info", "URL", page.url());

  // 预览 iframe 事实
  const previewFacts = await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    return { hasIframe: !!iframe, src: iframe?.getAttribute("src")?.slice(0, 100) };
  });
  record("工作台", "info", "预览 iframe", JSON.stringify(previewFacts));
  await page.waitForTimeout(6000);
  await shot("06-workspace-preview");

  writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({ prompt: PROMPT, findings, consoleErrors, failedRequests }, null, 2));
  console.log("\n=== 控制台错误 ==="); consoleErrors.slice(0, 10).forEach((e) => console.log("  " + e));
  console.log("=== 失败请求 ==="); failedRequests.slice(0, 10).forEach((e) => console.log("  " + e));
  console.log(`\n截图目录：${OUT}`);
} catch (error) {
  record("走查", "bug", "脚本异常", String(error).slice(0, 400));
  await shot("99-error");
  writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({ prompt: PROMPT, findings, consoleErrors, failedRequests }, null, 2));
} finally {
  await browser.close();
}
