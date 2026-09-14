#!/usr/bin/env node
/**
 * P3.2 承重假设验证：hero 区图片可定位性（红队最便宜测试，2026-09-09）。
 *
 * 假设：「把 hero.image 从 template-owned 升级为可替换资产槽」在多数模板可行。
 * 风险：hero 视觉可能是 CSS 背景图 / 内联 SVG / 无图，通用定位器会大面积 missing。
 *
 * 测法：逐模板注入草稿，在「首屏可见区域」（视口顶部 900px 内）统计 <img> 数量与尺寸，
 *       并检查是否存在 CSS background-image。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;

const { cloneDraft, defaultDraft } = await import("../lib/site-document.ts");
const { templates } = await import("../lib/site-model.ts");

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
try {
  await waitPort(PORT);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const rows = [];
  for (const template of templates) {
    const draft = cloneDraft(defaultDraft);
    draft.templateId = template.id;
    draft.revision = 71;
    draft.companyName = "启衡工业";
    draft.content.hero.title.zh = "让精密制造更可靠";
    draft.content.hero.subtitle.zh = "为新能源设备提供精密组件与联合工程服务。";
    const res = await page.goto(`${BASE}/api/templates/${template.id}/preview`);
    if (!res || res.status() !== 200) { rows.push({ id: template.id, error: res?.status() }); continue; }
    const info = await page.evaluate(({ tid, d }) => new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("timeout")), 12_000);
      const receive = (event) => {
        if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        // 首屏可见区域（视口顶部）
        const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
          const r = img.getBoundingClientRect();
          return r.top < 900 && r.width > 80 && r.height > 80;
        }).map((img) => {
          const r = img.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), alt: (img.alt || '').slice(0, 30), src: (img.getAttribute('src') || '').slice(-40) };
        }).sort((a, b) => b.w * b.h - a.w * a.h);
        // 首屏元素上的 CSS 背景图
        let bgCount = 0;
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top > 900 || r.width < 200 || r.height < 150) return;
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && !bg.includes('linear-gradient')) bgCount += 1;
        });
        // 内联 SVG 尺寸（logo 常见形态）
        const bigSvg = Array.from(document.querySelectorAll('svg')).filter((s) => {
          const r = s.getBoundingClientRect();
          return r.top < 900 && r.width > 150 && r.height > 100;
        }).length;
        resolve({ imgs, bgCount, bigSvg });
      };
      window.addEventListener("message", receive);
      window.postMessage({ type: "sitecraft:content", templateId: tid, siteKey: "probe", draft: d, locale: d.locale, variant: "preview" }, "*");
    }), { tid: template.id, d: draft });
    rows.push({ id: template.id, ...info });
  }

  console.log("");
  console.log("模板                  首屏可替换img  最大尺寸      背景图  大SVG  判定");
  console.log("─".repeat(90));
  let ok = 0;
  for (const r of rows) {
    if (r.error) { console.log(`${r.id.padEnd(20)} ERROR ${r.error}`); continue; }
    const top = r.imgs[0];
    const verdict = top ? "✅ 可定位" : r.bgCount ? "⚠ CSS 背景图" : r.bigSvg ? "⚠ 大 SVG" : "❌ 无图";
    if (top) ok += 1;
    console.log(`${r.id.padEnd(20)} ${String(r.imgs.length).padStart(10)}  ${(top ? `${top.w}x${top.h}` : "-").padEnd(12)} ${String(r.bgCount).padStart(5)}  ${String(r.bigSvg).padStart(5)}  ${verdict}`);
  }
  console.log("");
  console.log(`可定位 <img> 的模板：${ok}/${rows.filter((r) => !r.error).length}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 600));
  server.kill("SIGKILL");
}
