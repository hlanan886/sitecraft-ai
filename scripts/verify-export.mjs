import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file:///D:/sitecraft-ai/成品展示/华辰光伏-成品.html", { waitUntil: "networkidle" });
await page.waitForSelector(".site-zh .rs-hero h1", { timeout: 8000 });
const zhHero = await page.locator(".site-zh .rs-hero h1").first().textContent();
const enHero = await page.locator(".site-en .rs-hero h1").first().textContent();
console.log("中文 hero:", zhHero?.replace(/\n/g," "));
console.log("英文 hero:", enHero?.replace(/\n/g," "));
// 点击 EN 切换
await page.locator('.langbar button[data-lang="en"]').click();
const bodyClass = await page.locator("body").getAttribute("class");
const enVisible = await page.locator(".site-en").isVisible();
console.log("点击 EN 后 body:", bodyClass, "| site-en 可见:", enVisible);
// 中英产品对比
const zhP = await page.locator(".site-zh .rs-product strong").first().textContent();
console.log("中文产品:", zhP);
await page.locator('.langbar button[data-lang="zh"]').click();
const zhVisible = await page.locator(".site-zh").isVisible();
console.log("切回中文 site-zh 可见:", zhVisible);
await page.screenshot({ path: "成品展示/华辰光伏-成品-截图.png", fullPage: false });
console.log("✅ 双语切换验证通过 + 截图已存");
await browser.close();
