/**
 * 模板页去重后的结构断言（2026-09-09）。
 *
 * 背景：模板页曾同时存在四个「预览/开始」入口——封面缩略图、封面「预览整页」、
 * 卡片底部「预览」、底部「用这个模板开始对话」。用户逐一指出后只剩封面缩略图 +
 * 封面「预览整页」。脚本用真实 DOM 断言剩下的入口没被误删、删掉的没复活。
 *
 * 为什么不用静态 grep：卡片是客户端渲染，DOM 才是真相。
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// 不能用 networkidle：22 个模板 iframe 会持续拉资源，且 dev 模式有 HMR 长连接，永远不 idle。
await page.goto(`${BASE}/templates`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".template-card", { timeout: 30000 });

const probe = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".template-card")];
  const first = cards[0];
  const text = document.querySelector(".page-content")?.innerText ?? "";
  return {
    cardCount: cards.length,
    // 保留项
    thumbnail: first?.querySelector(".open-source-template-frame") !== null,
    previewOpen: first?.querySelector(".template-preview-open") !== null,
    sourceLine: first?.querySelector(".template-source")?.innerText?.trim() ?? null,
    // 删除项
    bottomCta: text.includes("用这个模板开始对话"),
    cardBottomPreview: first?.querySelector(".template-source a") !== null,
    sourceHasRightColumn: first?.querySelector(".template-source > div") !== null,
    demoLink: text.includes("官方演示"),
  };
});

const checks = [
  ["卡片数量 22", probe.cardCount === 22, probe.cardCount],
  ["封面缩略图仍在", probe.thumbnail, probe.thumbnail],
  ["封面「预览整页」仍在", probe.previewOpen, probe.previewOpen],
  ["卡片底部「预览」链已删", !probe.cardBottomPreview, probe.cardBottomPreview],
  ["底部「用这个模板开始对话」已删", !probe.bottomCta, probe.bottomCta],
  ["「官方演示」未复活", !probe.demoLink, probe.demoLink],
  ["source 只剩单行署名", !probe.sourceHasRightColumn, probe.sourceLine],
];

let failed = 0;
for (const [label, ok, actual] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}   (实际: ${actual})`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
