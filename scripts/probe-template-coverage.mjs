#!/usr/bin/env node
/**
 * 模板槽位覆盖探针（A3 基线，2026-09-09）。
 *
 * 对指定模板注入同一份「完整草稿」，回收 bridge 的 applied 报告，
 * 打印「哪些槽位落空」——这是判断「该模板是否需要专属适配器」的客观依据。
 *
 * 用法：node --experimental-strip-types scripts/probe-template-coverage.mjs [templateId...]
 * 默认探测 A3 的 4 个无适配器模板。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
const targets = process.argv.slice(2);
const templateIds = targets.length ? targets : ["tailwind-landing", "shadcn-landing", "nextjs-landing", "kindred"];

const { cloneDraft, defaultDraft } = await import("../lib/site-document.ts");

function completeDraft(templateId) {
  const draft = cloneDraft(defaultDraft);
  draft.templateId = templateId;
  draft.revision = 77;
  draft.companyName = "启衡工业";
  draft.siteName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  draft.content.hero.subtitle.zh = "为新能源设备提供精密组件与联合工程服务。";
  draft.content.about.title.zh = "关于启衡";
  draft.content.about.body.zh = "启衡工业成立于 2009 年，为新能源设备提供精密组件与联合工程服务。";
  draft.content.features.title.zh = "核心优势";
  draft.content.features.intro.zh = "从材料到交付的每一环都可核验。";
  draft.content.features.items = [
    { id: "traceability", title: { zh: "全程追溯", en: "Traceability" }, body: { zh: "从来料到出货保留可核验记录。", en: "Verifiable records from intake to shipment." } },
    { id: "tolerance", title: { zh: "微米级公差", en: "Micron tolerance" }, body: { zh: "关键尺寸控制在微米级。", en: "Critical dimensions held to microns." } },
    { id: "capacity", title: { zh: "柔性产能", en: "Flexible capacity" }, body: { zh: "小批量到大批量均可承接。", en: "From pilot runs to volume." } },
  ];
  draft.content.services.title.zh = "服务支持";
  draft.content.services.intro.zh = "从设计验证到量产交付。";
  draft.content.services.items = [
    { id: "engineering", title: { zh: "联合工程", en: "Joint engineering" }, body: { zh: "围绕应用边界共同完成设计验证。", en: "Validate designs against application constraints." } },
    { id: "sampling", title: { zh: "快速打样", en: "Rapid sampling" }, body: { zh: "五个工作日内交付样件。", en: "Samples within five working days." } },
  ];
  draft.content.products.title.zh = "产品中心";
  draft.content.products.intro.zh = "面向新能源与工业自动化。";
  draft.products = [
    { sku: "QH-100", name: { zh: "高稳定连接组件", en: "Stable connector assembly" }, summary: { zh: "面向高频振动工况。", en: "For high-vibration environments." }, category: "精密组件", status: "published", imageColor: "#d7e7d1" },
    { sku: "QH-200", name: { zh: "精密传动部件", en: "Precision drive part" }, summary: { zh: "适用于高负载场景。", en: "For high-load scenarios." }, category: "精密组件", status: "published", imageColor: "#cfe0ee" },
  ];
  draft.content.contact.title.zh = "把需求交给工程团队";
  draft.content.contact.body.zh = "提交图纸与目标交期，工程团队将在一个工作日内回复。";
  draft.content.contact.email = "engineering@qiheng.example";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  return draft;
}

function waitPort(port, timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(800);
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("timeout", () => { socket.destroy(); retry(); });
      socket.once("error", () => { socket.destroy(); retry(); });
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error("server_timeout")) : setTimeout(tick, 700));
    tick();
  });
}

const server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d.toString(); });
server.stderr.on("data", (d) => { serverLog += d.toString(); });

let browser;
try {
  await waitPort(PORT);
  browser = await chromium.launch();
  const page = await browser.newPage();

  const rows = [];
  for (const templateId of templateIds) {
    const draft = completeDraft(templateId);
    const response = await page.goto(`${BASE}/api/templates/${templateId}/preview`);
    if (!response || response.status() !== 200) {
      rows.push({ templateId, error: `preview_http_${response?.status()}` });
      continue;
    }
    const report = await page.evaluate(({ tid, d }) => new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("bridge_apply_timeout")), 12_000);
      const receive = (event) => {
        if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        resolve({
          appliedSlots: event.data.appliedSlots,
          visibleSlots: event.data.visibleSlots,
          missingSlots: event.data.missingSlots,
          residualDemoSlots: event.data.residualDemoSlots,
          generatedContentSections: event.data.generatedContentSections,
        });
      };
      window.addEventListener("message", receive);
      window.postMessage({ type: "sitecraft:content", templateId: tid, siteKey: "probe", draft: d, locale: d.locale, variant: "preview" }, "*");
    }), { tid: templateId, d: draft });

    const expected = ["hero.title", "about.body", "features.items", "services.items", "products", "contact.title", "contact.body", "contact.email", "contact.phone", "contact.address"];
    // slot 形如 hero.title.zh / about.body / features.items.<id>.title.zh / products.<sku>.name.zh
    // → 归一到 manifest 的 target 口径（10 个）。
    const toTarget = (slot) => {
      const s = String(slot).replace(/\.(zh|en)$/, "");
      if (s.startsWith("products.")) return "products";
      return s.split(".").slice(0, 2).join(".");
    };
    const visibleTargets = new Set([...(report.visibleSlots || []), ...(report.appliedSlots || [])].map(toTarget));
    rows.push({
      templateId,
      applied: (report.appliedSlots || []).length,
      visible: (report.visibleSlots || []).length,
      missing: report.missingSlots || [],
      residualDemo: report.residualDemoSlots || [],
      generated: report.generatedContentSections || [],
      uncovered: expected.filter((t) => !visibleTargets.has(t) && !visibleTargets.has(t.split(".")[0])),
    });
  }

  console.log("");
  console.log("模板                  applied visible  missing                                    generated                         residualDemo");
  console.log("─".repeat(140));
  for (const r of rows) {
    if (r.error) { console.log(`${r.templateId.padEnd(20)} ERROR: ${r.error}`); continue; }
    console.log(
      `${r.templateId.padEnd(20)}  ${String(r.applied).padStart(5)}  ${String(r.visible).padStart(6)}   ${(r.missing.join(",") || "-").padEnd(40)}  ${(r.generated.join(",") || "-").padEnd(32)}  ${(r.residualDemo.join(",") || "-")}`,
    );
  }
  console.log("");
  console.log("未覆盖的必需目标（按 manifest 10 槽口径）：");
  for (const r of rows) {
    if (r.error) continue;
    console.log(`  ${r.templateId.padEnd(20)} ${r.uncovered.join(", ") || "✅ 全覆盖"}`);
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  server.kill("SIGKILL");
}
