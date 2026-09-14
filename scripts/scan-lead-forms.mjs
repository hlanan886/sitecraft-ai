#!/usr/bin/env node
/**
 * 询盘表单静态探针（P3.5 / A8，2026-09-09）。
 *
 * 机械门禁查槽位、截图看不见表单死链——「访客能不能提交询盘」只能靠专门探针回答。
 * 本脚本扫 22 个模板的**静态产物**（vendor 快照），判定每个模板自带表单的可用性：
 *   - 有无 `<form>`
 *   - 是否含 name / email / message 三类必需字段（按 name/type/placeholder 信号识别）
 *   - action 是否指向死链（mailto: / example.com / 空）
 *
 * 用途：决定 P3.5 的注入覆盖面（无可用表单 = 需要 bridge 注入）。
 *
 * 用法：node --experimental-strip-types scripts/scan-lead-forms.mjs [templateId...]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const { templateCatalog } = await import("../lib/template-catalog.ts");
const { getTemplateStaticRoot } = await import("../lib/template-static.ts");

const targets = process.argv.slice(2);
const entries = targets.length
  ? templateCatalog.filter((template) => targets.includes(template.id))
  : templateCatalog;

/** 模板静态产物入口：复用 getTemplateStaticRoot，与预览路由同口径（dist → 根 → next export） */
function entryHtml(templateId) {
  const staticRoot = getTemplateStaticRoot(templateId);
  if (!staticRoot) return null;
  const file = path.join(staticRoot, "index.html");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function formsOf(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].map((match) => {
    const attrs = match[0].slice(0, match[0].indexOf(">") + 1);
    const body = match[1];
    const fields = [...body.matchAll(/<(?:input|textarea)\b[^>]*>/gi)].map((field) => {
      const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(field[0])?.[1] ?? "";
      const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(field[0])?.[1] ?? (/textarea/i.test(field[0]) ? "textarea" : "text");
      const placeholder = /\bplaceholder\s*=\s*["']([^"']*)["']/i.exec(field[0])?.[1] ?? "";
      return { name, type, placeholder };
    });
    return {
      action: /\baction\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "",
      fields,
      hasSubmit: /type\s*=\s*["']submit["']|<button\b/i.test(body),
    };
  });
}

function classify(form) {
  const signals = form.fields.map((field) => `${field.name} ${field.type} ${field.placeholder}`.toLowerCase());
  const hasName = signals.some((signal) => /name|姓名|your name/.test(signal));
  const hasEmail = signals.some((signal) => /mail|邮箱|email/.test(signal));
  const hasMessage = signals.some((signal) => /message|comment|content|body|留言|需求|说明/.test(signal));
  const honeypot = form.fields.some((field) => /website|url|hp_/i.test(field.name) && field.type === "hidden");
  const staleAction = /^(mailto:|https?:\/\/example\.)/i.test(form.action);
  return { hasName, hasEmail, hasMessage, honeypot, staleAction, usable: form.hasSubmit && hasName && hasEmail && hasMessage };
}

const rows = entries.map((template) => {
  const html = entryHtml(template.id);
  if (html === null) return { id: template.id, error: "no_static_entry" };
  const forms = formsOf(html).map(classify);
  return {
    id: template.id,
    forms: forms.length,
    usable: forms.filter((form) => form.usable).length,
    honeypot: forms.some((form) => form.usable && form.honeypot),
    staleAction: forms.filter((form) => form.staleAction).length,
  };
});

console.log("");
console.log("模板                  表单  可用  蜜罐  死链action");
console.log("─".repeat(64));
for (const row of rows) {
  if (row.error) { console.log(`${row.id.padEnd(20)} ERROR: ${row.error}`); continue; }
  console.log(
    `${row.id.padEnd(20)} ${String(row.forms).padStart(4)} ${String(row.usable).padStart(5)} ${(row.honeypot ? "✅" : "—").padStart(5)} ${String(row.staleAction).padStart(10)}`,
  );
}
const needInjection = rows.filter((row) => !row.error && row.usable === 0).map((row) => row.id);
console.log("");
console.log(`自带可用询盘表单：${rows.length - needInjection.length}/${rows.length}`);
console.log(`需要 bridge 注入：${needInjection.length} 个 → ${needInjection.join(", ")}`);
