/** 一次性诊断工具 · 非门禁 · 无验收引用（2026-09-13 收编，用户裁决保留）。 */
/**
 * 复审方裁决探针（2026-09-13）：同一把尺子量"e2e 绿"与"手工实测空"的矛盾。
 *
 * 关键差异：Playwright 的 `page.goto` 等 **load**；裸 `page.goto` + `evaluate`
 * 可能在稳定态前读数（附则 A2 时序变体）。本探针**显式**跑三种等待，
 * 把 h1 / 正文 / 槽位沿时间轴打出来，并记录 CSP 违规与请求头。
 */
import { chromium } from "playwright";

const URL = "http://127.0.0.1:3211/api/templates/shadcn-landing2/preview";
const b = await chromium.launch();
const p = await b.newPage();

const cspViolations = [];
const requests = [];
p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 90)); });
p.on("response", (r) => { if (r.url().includes("/preview")) requests.push({ url: r.url(), status: r.status(), csp: r.headers()["content-security-policy"] ?? "(none)" }); });

const snap = async (pg, tag) => ({
  tag,
  h1Filled: await pg.evaluate(() => [...document.querySelectorAll("h1")].filter((el) => el.innerText?.trim()).length),
  bodyTextLen: await pg.evaluate(() => document.body.innerText.trim().length),
  bodyHead: await pg.evaluate(() => document.body.innerText.trim().slice(0, 60)),
});

const t0 = Date.now();
const resp = await p.goto(URL); // 默认等 load —— 与 spec 同条件
console.log("NAV", JSON.stringify({ status: resp?.status(), ms: Date.now() - t0 }));
console.log("SNAP", JSON.stringify(await snap(p, "after-load")));
await p.waitForTimeout(3000);
console.log("SNAP", JSON.stringify(await snap(p, "load+3s")));

const report = await p.evaluate(
  () => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), 12_000);
    const recv = (e) => {
      if (e.data?.type !== "sitecraft:applied") return;
      clearTimeout(t); window.removeEventListener("message", recv);
      resolve({ revision: e.data.revision, incompatible: e.data.incompatible, missingSlots: e.data.missingSlots, visibleSlots: e.data.visibleSlots });
    };
    window.addEventListener("message", recv);
    window.postMessage({
      type: "sitecraft:content", templateId: "shadcn-landing2", locale: "zh", variant: "preview", expectedTargets: ["heroTitle"],
      draft: { revision: 73, siteName: { zh: "远航科技", en: "Voyage Technology" },
        content: { hero: { title: { zh: "让跨境团队更快交付产品网站", en: "Reliable solutions" },
          subtitle: { zh: "从产品展示到询盘转化，保持信息清晰可信。", en: "Clear stories" },
          cta: { zh: "查看产品", en: "View products" } } }, products: [] } }, "*");
  }),
);
console.log("BRIDGE", JSON.stringify(report));
await p.waitForTimeout(2000);
console.log("SNAP", JSON.stringify(await snap(p, "inject+2s")));

console.log("CSP-VIOLATIONS", cspViolations.length, JSON.stringify(cspViolations[0] ?? null));
console.log("PREVIEW-RESPONSES", JSON.stringify(requests));
await b.close();
