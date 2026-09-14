/** 一次性诊断工具 · 非门禁 · 无验收引用（2026-09-13 收编，用户裁决保留）。 */
/** 桥接报告 vs 用户实际看得见的内容，一次问清。 */
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://127.0.0.1:3210/api/templates/shadcn-landing2/preview");
const report = await p.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
  const t = setTimeout(() => resolve({ timeout: true }), 8000);
  const recv = (e: MessageEvent) => {
    if (e.data?.type !== "sitecraft:applied") return;
    clearTimeout(t); window.removeEventListener("message", recv);
    resolve({ incompatible: e.data.incompatible, missingSlots: e.data.missingSlots, visible: Object.keys(e.data.visibleTextsBySlot ?? {}) });
  };
  window.addEventListener("message", recv);
  window.postMessage({ type: "sitecraft:content", templateId: "shadcn-landing2", locale: "zh", variant: "preview", expectedTargets: ["heroTitle"],
    draft: { revision: 900, siteName: { zh: "远航科技", en: "V" },
      content: { hero: { title: { zh: "让跨境团队更快交付产品网站", en: "R" }, subtitle: { zh: "s", en: "s" }, cta: { zh: "c", en: "c" } } }, products: [] } }, "*");
}));
// 用户到底看不看得见：统计真正被绘制出来的可见文本
const painted = await p.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = (el as HTMLElement).getBoundingClientRect();
    const txt = (el as HTMLElement).innerText?.trim();
    if (txt && r.width > 10 && r.height > 5) out.push(txt.slice(0, 30));
  }
  return { paintedTexts: [...new Set(out)].slice(0, 8), paintedCount: new Set(out).size, bodyInnerText: document.body.innerText.trim().slice(0, 80) };
});
console.log("BRIDGE-REPORT", JSON.stringify(report));
console.log("PAINTED", JSON.stringify(painted));
await b.close();
