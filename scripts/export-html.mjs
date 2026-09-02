import { chromium } from "@playwright/test";
import fs from "node:fs";

const SITE = "d9731970-aa04-4257-8173-6a524d6417eb";
const OUT = "D:/sitecraft-ai/成品展示/华辰光伏-成品.html";
fs.mkdirSync("D:/sitecraft-ai/成品展示", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 抓中文版
await page.goto(`http://localhost:3000/export/${SITE}`, { waitUntil: "networkidle" });
await page.waitForSelector(".rendered-site", { timeout: 10000 });
const zhHtml = await page.locator(".rendered-site").first().evaluate(el => el.outerHTML);

// 抓英文版
await page.goto(`http://localhost:3000/export/${SITE}?lang=en`, { waitUntil: "networkidle" });
await page.waitForSelector(".rendered-site", { timeout: 10000 });
const enHtml = await page.locator(".rendered-site").first().evaluate(el => el.outerHTML);

// 提取 .rs-* 样式
const allCss = fs.readFileSync("D:/sitecraft-ai/app/globals.css", "utf8");
const ruleBlocks = [];
let inBlock = false, cur = [];
for (const line of allCss.split("\n")) {
  cur.push(line);
  const hasRs = line.includes("rendered-site") || line.includes(".rs-");
  if (hasRs) inBlock = true;
  if (inBlock && line.includes("}")) { ruleBlocks.push(cur.join("\n")); cur = []; inBlock = false; }
}
const rsCss = ruleBlocks.join("\n");

// 行业文案替换（zh/en 版都做）
const solarize = (h) => {
  const repl = [
    ['LIVE / Astro + Tailwind + TypeScript', '25+ YEARS PV EXPERIENCE'],
    ['ENGINEERING', 'SOLAR'], ['GLOBAL', 'EXPORT'], ['VERIFIED', 'CERTIFIED'],
    ['RESPONSIVE DELIVERY', 'EUROPE-READY'], ['QUALITY SYSTEM', 'ISO CERTIFIED'],
    ['GLOBAL SERVICE', 'GLOBAL SUPPORT'], ['AI READY', '25Y EXPERTISE'],
  ];
  for (const [f, t] of repl) h = h.split(f).join(t);
  return h;
};
const zh = solarize(zhHtml), en = solarize(enHtml);

// 去掉语言切换按钮（导出页没传 onLocaleChange，rs-locale 是空壳，移除避免误导）
const stripLocale = (h) => h.replace(/<div class="rs-locale"[\s\S]*?<\/div>\s*/g, "");
const zhClean = stripLocale(zh), enClean = stripLocale(en);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>华辰光伏 · Huachen Solar</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family:'Manrope','Noto Sans SC',system-ui,sans-serif; -webkit-font-smoothing:antialiased; background:#f4f7f2; }
/* 语言切换条 */
.langbar { position: fixed; top: 16px; right: 16px; z-index: 999; display:flex; gap:6px; background:rgba(255,255,255,.92); border:1px solid #d6e4d6; border-radius:999px; padding:5px; box-shadow:0 8px 24px rgba(20,35,25,.12); }
.langbar button { border:0; background:transparent; color:#718078; font-size:12px; font-weight:700; padding:7px 14px; border-radius:999px; cursor:pointer; font-family:inherit; }
.langbar button.active { background:#2e6b4f; color:#fff; }
.site-zh, .site-en { display:none; }
body.lang-zh .site-zh { display:block; }
body.lang-en .site-en { display:block; }
${rsCss}
</style>
</head>
<body class="lang-zh">
<div class="langbar" aria-label="语言切换">
  <button class="active" data-lang="zh">中</button>
  <button data-lang="en">EN</button>
</div>
<div class="site-zh rendered-site-wrap">${zhClean}</div>
<div class="site-en rendered-site-wrap">${enClean}</div>
<script>
document.querySelectorAll('.langbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.body.className = 'lang-' + btn.dataset.lang;
    document.querySelectorAll('.langbar button').forEach(b => b.classList.toggle('active', b === btn));
  });
});
</script>
</body>
</html>`;
fs.writeFileSync(OUT, html, "utf8");
console.log("✅ 双语成品已生成:", OUT, "(", fs.statSync(OUT).size, "字节 )");
await browser.close();
