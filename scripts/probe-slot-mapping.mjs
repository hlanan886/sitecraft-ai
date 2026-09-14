#!/usr/bin/env node
/**
 * P3.1 承重假设验证（红队最便宜测试，2026-09-09）。
 *
 * 假设：「点选 → 靠 data-sitecraft-slot 反向映射成 draft 操作」可行。
 * 风险：slot 由 20 个 adapter 手写 + 共享引擎多处写入，格式未必都可映射。
 * 测试：对 22 个模板注入完整草稿，收集所有 data-sitecraft-slot 值，按映射规则分类。
 *
 * 输出：每模板「可映射 / 有意拒绝 / 未预期」三类计数，以及全局汇总。
 * 用法：node --experimental-strip-types scripts/probe-slot-mapping.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3216;
const BASE = `http://127.0.0.1:${PORT}`;

const { cloneDraft, defaultDraft } = await import("../lib/site-document.ts");
const { templates } = await import("../lib/site-model.ts");

/** 与 lib/inline-edit-mapping.ts 设计一致的分类规则 */
function classify(slot) {
  // 有意拒绝：模板 UI 文案 / 非文本语义
  if (/^(footer|form|brand\.logo|hero\.image)/.test(slot)) return "rejected";
  if (/\.visibility$|^sections\.|^template$/.test(slot)) return "rejected";
  // 可映射：set_text（本地化 target）
  if (/^(hero|about|features|services|products|contact|navigation)\./.test(slot)) {
    if (/^products\.[^.]+\.(name|summary)\.(zh|en)$/.test(slot) || /^products\.[^.]+\.[^.]+\.[^.]+\.[^.]+\.[^.]+$/.test(slot)) return "mappable";
    if (/^products\./.test(slot)) return /\.(name|summary)\.(zh|en)$/.test(slot) ? "mappable" : "unexpected";
    if (/^features\.items\.|^services\.items\./.test(slot)) return /\.(title|body)\.(zh|en)$/.test(slot) ? "mappable" : "unexpected";
    return /\.(zh|en)$/.test(slot) || /^(about|features|services|products|contact|navigation)\.[a-z]+$/.test(slot) ? "mappable" : "unexpected";
  }
  // 非本地化 target
  if (/^(companyName|siteName|industry|goal)(\.(zh|en))?$/.test(slot)) return "mappable";
  if (/^contact\.(email|phone|address)\.(zh|en)$/.test(slot)) return "mappable";
  return "unexpected";
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
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const all = new Map();
try {
  await waitPort(PORT);
  browser = await chromium.launch();
  const page = await browser.newPage();
  const rows = [];
  for (const template of templates) {
    const draft = cloneDraft(defaultDraft);
    draft.templateId = template.id;
    draft.revision = 63;
    draft.companyName = "启衡工业";
    draft.content.hero.title.zh = "让精密制造更可靠";
    draft.content.about.title.zh = "关于启衡";
    draft.content.about.body.zh = "启衡工业为新能源设备提供精密组件。";
    draft.content.features.title.zh = "核心优势";
    draft.content.features.items = [{ id: "t", title: { zh: "全程追溯", en: "T" }, body: { zh: "可核验记录。", en: "B" } }];
    draft.content.services.title.zh = "服务支持";
    draft.content.services.items = [{ id: "e", title: { zh: "联合工程", en: "E" }, body: { zh: "共同验证。", en: "B" } }];
    draft.content.products.title.zh = "产品中心";
    draft.products = [{ sku: "QH-100", name: { zh: "高稳定连接组件", en: "A" }, summary: { zh: "面向振动工况。", en: "B" }, category: "c", status: "published", imageColor: "#ddd" }];
    draft.content.contact.title.zh = "联系我们";
    draft.content.contact.body.zh = "欢迎提交需求。";
    draft.content.contact.email = "e@qiheng.example";
    draft.content.contact.phone = "+86 21 5555 0100";
    draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";

    const res = await page.goto(`${BASE}/api/templates/${template.id}/preview`);
    if (!res || res.status() !== 200) { rows.push({ id: template.id, error: res?.status() }); continue; }
    const slots = await page.evaluate(({ tid, d }) => new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("timeout")), 12_000);
      const receive = (event) => {
        if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        resolve(Array.from(new Set(Array.from(document.querySelectorAll("[data-sitecraft-slot]")).map((n) => n.dataset.sitecraftSlot))));
      };
      window.addEventListener("message", receive);
      window.postMessage({ type: "sitecraft:content", templateId: tid, siteKey: "probe", draft: d, locale: d.locale, variant: "preview" }, "*");
    }), { tid: template.id, d: draft });

    const buckets = { mappable: [], rejected: [], unexpected: [] };
    for (const s of slots) buckets[classify(s)].push(s);
    for (const s of slots) if (!all.has(s)) all.set(s, classify(s));
    rows.push({ id: template.id, total: slots.length, ...buckets });
  }

  console.log("");
  console.log("模板                  槽位总数  可映射  有意拒绝  未预期");
  console.log("─".repeat(70));
  for (const r of rows) {
    if (r.error) { console.log(`${r.id.padEnd(20)} ERROR ${r.error}`); continue; }
    console.log(`${r.id.padEnd(20)} ${String(r.total).padStart(6)}  ${String(r.mappable.length).padStart(6)}  ${String(r.rejected.length).padStart(8)}  ${String(r.unexpected.length).padStart(6)}`);
    if (r.unexpected.length) console.log(`   ⚠ 未预期: ${r.unexpected.join(", ")}`);
  }
  console.log("");
  const counts = { mappable: 0, rejected: 0, unexpected: 0 };
  for (const [, c] of all) counts[c] += 1;
  console.log(`全 22 模板去重后：共 ${all.size} 种 slot —— 可映射 ${counts.mappable} / 有意拒绝 ${counts.rejected} / 未预期 ${counts.unexpected}`);
  const unexpected = [...all.entries()].filter(([, c]) => c === "unexpected").map(([s]) => s);
  if (unexpected.length) console.log(`未预期 slot 明细：${unexpected.join(", ")}`);
  const rejected = [...all.entries()].filter(([, c]) => c === "rejected").map(([s]) => s);
  console.log(`有意拒绝明细：${rejected.join(", ")}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 600));
  server.kill("SIGKILL");
}
