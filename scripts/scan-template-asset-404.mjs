#!/usr/bin/env node
/**
 * 模板本地资源 404 探针（2026-09-09）。
 *
 * 逐个加载 22 个模板的 preview 路由，数**本地** 404（排除 `/api/templates/` 自身的失败，
 * 那类已由调用方处理）。回答的是「这个模板的图/字体/脚本有没有真正加载出来」——
 * 单看渲染截图看不准（缺 JS 的页面可能仍显示骨架），必须数网络请求。
 *
 * 为什么需要它：Astro/Vite 构建后的 JS 把资源写成纯字符串（`src:"/assets/x.png"`），
 * 根路径不会被 `<base>` 修正，请求打到站点根 → 404。2026-09-09 实测 6/22 模板中招。
 *
 * 用法：node --experimental-strip-types scripts/scan-template-asset-404.mjs [templateId...]
 * 期望：全部模板为 0（shadcn-landing2 的 `/index.txt?_rsc=` 属 Next.js 预取噪音，可忽略）
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const { templateCatalog } = await import("../lib/template-catalog.ts");

const targets = process.argv.slice(2);
const ids = targets.length ? targets : templateCatalog.map((t) => t.id);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const rows = [];
for (const id of ids) {
  const page = await browser.newPage();
  const local = [];
  page.on("response", (response) => {
    const url = response.url();
    const isLocalMiss = response.status() >= 400
      && url.includes("localhost")
      && !url.includes(`/api/templates/${id}/`); // 路由自身失败不算资源问题
    if (isLocalMiss) local.push(url.replace(BASE, ""));
  });
  try {
    await page.goto(`${BASE}/api/templates/${id}/preview`, { waitUntil: "networkidle", timeout: 25_000 });
  } catch { /* 超时也继续统计已收到的失败 */ }
  await page.waitForTimeout(2_500);
  rows.push({ id, count: local.length, sample: local.slice(0, 2) });
  await page.close();
}
await browser.close();

console.log("");
console.log("模板                  本地404  样例");
console.log("─".repeat(78));
for (const row of rows) {
  console.log(`${row.id.padEnd(20)} ${String(row.count).padStart(6)}  ${row.sample.join("  ")}`);
}
const broken = rows.filter((row) => row.count > 0);
console.log("");
console.log(`有本地 404 的模板：${broken.length}/${rows.length}`);
if (broken.length) console.log(`  ${broken.map((row) => `${row.id}(${row.count})`).join(", ")}`);
