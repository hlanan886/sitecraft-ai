/** 一次性诊断工具 · 非门禁 · 无验收引用（2026-09-13 收编，用户裁决保留）。 */
/**
 * 复审方稳定性探针：空页到底可不可复现？
 * 10 次「全新 context + 全新 page」冷加载，每次都读 h1/正文/可见叶子文本。
 */
import { chromium } from "playwright";

const URL = "http://127.0.0.1:3211/api/templates/shadcn-landing2/preview";
const b = await chromium.launch();
const rows = [];
for (let i = 0; i < 10; i++) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  let violations = 0;
  p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations++; });
  const t0 = Date.now();
  await p.goto(URL);
  await p.waitForTimeout(2500); // 稳定态窗
  const r = await p.evaluate(() => ({
    h1Filled: [...document.querySelectorAll("h1")].filter((el) => el.innerText?.trim()).length,
    bodyTextLen: document.body.innerText.trim().length,
    head: document.body.innerText.trim().slice(0, 28),
  }));
  rows.push({ i, ms: Date.now() - t0, violations, ...r });
  await ctx.close();
}
console.log(JSON.stringify(rows, null, 1));
const empty = rows.filter((r) => r.h1Filled === 0).length;
console.log("EMPTY-RUNS", empty, "/", rows.length);
await b.close();
