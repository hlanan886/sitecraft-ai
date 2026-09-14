#!/usr/bin/env node
/**
 * 发布态询盘表单探针（P3.5 / A8，2026-09-09）。
 *
 * 回答一个机械门禁回答不了、截图也看不见的问题：**发布后的页面里，访客到底能不能提交询盘？**
 * 对 22 个模板逐个用 `variant: "published"` 注入同一份草稿，检查渲染结果里：
 *   1. 是否存在可提交的 `<form>`（含 name/email/message 三个必需字段）
 *   2. 表单里是否有蜜罐字段（反垃圾）
 *   3. 是否存在残留的 demo action（mailto:/example.com）
 *
 * 用法：node --experimental-strip-types scripts/probe-lead-form.mjs [templateId...]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

const root = path.resolve(import.meta.dirname, "..");
/**
 * 默认复用已在跑的 dev server（`PORT` 环境变量指定，默认 3000）。
 * 单实例的 Next dev 在 Windows 上偶发 `ERR_CONNECTION_RESET`——探针宁可连现成的，也不要另起一个。
 */
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const { cloneDraft, defaultDraft } = await import("../lib/site-document.ts");
const { templateCatalog } = await import("../lib/template-catalog.ts");

const targets = process.argv.slice(2);
const templateIds = targets.length ? targets : templateCatalog.map((template) => template.id);

function draftFor(templateId) {
  const draft = cloneDraft(defaultDraft);
  draft.templateId = templateId;
  draft.revision = 91;
  draft.companyName = "启衡工业";
  draft.siteName = "启衡工业";
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

/** 端口已有人监听就复用，不另起 dev server */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

const reuse = await portOpen(PORT);
let server = null;
let serverLog = "";
if (!reuse) {
  server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
}

let browser;
try {
  await waitPort(PORT);
  browser = await chromium.launch();
  const page = await browser.newPage();
  const rows = [];

  for (const templateId of templateIds) {
    const draft = draftFor(templateId);
    const response = await page.goto(`${BASE}/api/templates/${templateId}/preview`).catch(() => null);
    if (!response || response.status() !== 200) {
      rows.push({ templateId, error: `preview_http_${response?.status() ?? "reset"}${serverLog.includes("Error") ? ` | ${serverLog.split("\n").filter((line) => /Error|error/.test(line)).slice(-2).join(" ").slice(0, 300)}` : ""}` });
      continue;
    }
    /**
     * ⚠️ 单模板的评估必须**包起来**。
     *
     * 2026-09-12 实测：`preview/route.ts` 里 `copy is not defined` 那个缺陷激活时，
     * `applyContent` 抛异常 → 从不回发 `sitecraft:applied` → 这行 `page.evaluate` 等到超时
     * → 抛 `bridge_apply_timeout`。而在修复前，这个异常**没有 try/catch**，
     * 于是探针**直接崩掉退出**，打印的是一段看着像环境问题的 bridge 超时栈。
     *
     * 那正是缺陷能活三天的原因：探针跑过、崩过，但崩得**不像"询盘表单坏了"**，
     * 而像一个网络/桥接抖动。现在把每次评估转成一行可读的失败记录，
     * 并计入 `errored` → 非零退出。
     */
    let result;
    try {
      result = await page.evaluate(({ tid, d }) => new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("bridge_apply_timeout")), 15_000);
        const receive = (event) => {
          if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
          window.clearTimeout(timeout);
          window.removeEventListener("message", receive);
          const forms = Array.from(document.querySelectorAll("form"));
          resolve(forms.map((form) => {
            const fields = Array.from(form.querySelectorAll("input, textarea")).map((field) => ({
              name: field.getAttribute("name") || "",
              type: field.getAttribute("type") || field.tagName.toLowerCase(),
              hidden: field.getAttribute("type") === "hidden" || field.offsetParent === null,
            }));
            return {
              action: form.getAttribute("action") || "",
              hasSubmit: Boolean(form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')),
              fields,
              honeypot: fields.some((field) => /website|url|company_url|hp_/i.test(field.name) && field.hidden),
              slot: form.closest("[data-sitecraft-slot]")?.dataset.sitecraftSlot || "",
              inGenerated: Boolean(form.closest("[data-sitecraft-generated-content]")),
            };
          }));
        };
        window.addEventListener("message", receive);
        window.postMessage({ type: "sitecraft:content", templateId: tid, siteKey: "probe", draft: d, locale: d.locale, variant: "published" }, "*");
      }), { tid: templateId, d: draft });
    } catch (error) {
      // 注入脚本抛异常时不会有 sitecraft:applied —— 这**本身就是**询盘表单坏的信号，
      // 不是"环境抖动"。如实标红，别让它退化成一条看不懂的栈。
      rows.push({
        templateId,
        error: `注入失败（无 sitecraft:applied 回执）：${error?.message || error}`,
      });
      continue;
    }

    const usable = result.filter((form) => {
      const names = form.fields.map((field) => field.name.toLowerCase());
      return form.hasSubmit
        && names.some((name) => /name/.test(name))
        && names.some((name) => /mail/.test(name))
        && names.some((name) => /message|comment|content|body/.test(name));
    });
    const stale = result.filter((form) => /^(mailto:|https?:\/\/example\.)/i.test(form.action));
    rows.push({
      templateId,
      forms: result.length,
      usable: usable.length,
      honeypot: usable.some((form) => form.honeypot),
      staleAction: stale.map((form) => form.action),
      generated: result.some((form) => form.inGenerated),
    });
  }

  console.log("");
  console.log("模板                  表单  可用  蜜罐  生成区  残留action");
  console.log("");
  console.log("─".repeat(96));
  for (const row of rows) {
    if (row.error) { console.log(`${row.templateId.padEnd(20)} ERROR: ${row.error}`); continue; }
    console.log(
      `${row.templateId.padEnd(20)} ${String(row.forms).padStart(4)} ${String(row.usable).padStart(5)} ${(row.honeypot ? "✅" : "—").padStart(5)} ${(row.generated ? "是" : "—").padStart(6)}  ${row.staleAction.join(",") || "-"}`,
    );
  }
  const missing = rows.filter((row) => !row.error && row.usable === 0).map((row) => row.templateId);
  const errored = rows.filter((row) => row.error).map((row) => row.templateId);
  console.log("");
  console.log(`可用询盘表单：${rows.filter((row) => !row.error && row.usable > 0).length}/${rows.length}`);
  if (missing.length) console.log(`缺表单：${missing.join(", ")}`);
  if (errored.length) {
    // 只打每个模板的第一行原因，去掉 evaluate 的长栈——栈对读的人没用，
    // 有用的信息是"这个模板的注入脚本抛异常了"。
    console.log(`注入失败：${errored.map((id) => {
      const reason = String(rows.find((row) => row.templateId === id)?.error || "").split("\n")[0];
      return `${id}（${reason}）`;
    }).join("; ")}`);
  }
  const staleCount = rows.filter((row) => !row.error && row.staleAction.length).length;
  console.log(`残留 demo action：${staleCount} 个模板`);

  /**
   * ⚠️ 退出码——**以前没有这一段，所以这个脚本永远不会失败**。
   *
   * 2026-09-12：`probe-lead-form.mjs` 早就写好了、逻辑也对，但既没接进 `package.json`，
   * 也不会用非零退出码报错——于是它**跑过一次就再没人跑**，而它本该拦的那个缺陷
   * （`preview/route.ts` 里 `copy is not defined` → 22 个模板里 20 个的发布站没有询盘表单）
   * 静默活了三天，直到客户旅程真机实测才被发现。
   *
   * 一个不会失败的探针 = 一个不会拦人的门禁。`docs/plans/2026-09-09-quality-plan.md`
   * 的验证口径里写着它有「✅ 阻断权」，但那时它**没有**任何阻断能力。
   * 现在补上：缺表单或探针自身出错一律非零退出。
   */
  if (missing.length || errored.length) {
    console.error("");
    console.error(`❌ 询盘门禁失败：${missing.length} 个模板没有可用表单${errored.length ? `，${errored.length} 个模板注入失败` : ""}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    server.kill("SIGKILL");
  }
}
