/**
 * 把真实生成的站点渲染出来看一眼 —— 用于 settle「F1 demo 残留」。
 *
 * 为什么需要：coverage.residualDemoSlots 是**草稿槽位**口径，
 * 而模板自身可能还带着未登记的 demo 内容（不在槽位表里）。
 * 用户肉眼看到的才算数，所以必须截图。
 *
 * 用法：node scripts/shot-generated.mjs <siteId> <templateId> <输出文件名>
 */
import { chromium } from "playwright";

const [, , siteId, templateId, outName] = process.argv;
const url = `http://localhost:3000/templates/${templateId}/preview?siteId=${siteId}`;
const out = `/tmp/${outName || siteId}.png`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// 不用 networkidle：iframe 持续拉资源 + dev HMR 长连接，永远不 idle
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("iframe", { timeout: 30000 });
// 给 iframe 内的 bridge 注入内容留时间
await page.waitForTimeout(8000);
await page.screenshot({ path: out, fullPage: true });
console.log("saved:", out);
console.log("url:", url);
await browser.close();
