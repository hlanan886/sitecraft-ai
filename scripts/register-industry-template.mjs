#!/usr/bin/env node
/**
 * 把一个**已在仓库里**的行业模板目录登记为运行时模板。
 *
 * 与 `precipitate-template.mjs` 的区别:
 *   - `precipitate-template.mjs`:把**仓库外**的现成静态站搬进来(扫描 → 上传 → 落盘),
 *     模板源文件不在版本控制里;
 *   - 本脚本:模板源文件**已经在仓库里**(`vendor/industry-templates/<id>/`),
 *     只是把它登记进运行时注册表,让预览/生成/发布认得它。
 *
 * 为什么保留两条路:前者用于"把别人做的站接进来"(阶段 A 的链路验证),
 * 后者用于"我们自己做的行业模板"(阶段 B 的正常形态)。混在一起会让
 * 「源文件到底在不在 git 里」变得模糊——而这件事决定模板能不能被复用和回滚。
 *
 * 用法:
 *   node scripts/register-industry-template.mjs --id fengji \
 *     --name "风机设备 / Industrial Fan" --category 制造业 \
 *     --description "工业风机企业官网:分类导航、产品展示、在线询价。" \
 *     [--tags 工业风机,制造业,产品目录] [--base http://localhost:3210]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};
const TEXT_EXT = new Set([".css", ".js", ".mjs", ".cjs", ".json", ".txt", ".xml", ".webmanifest"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    out[token.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const templateId = args.id;
if (!templateId) {
  console.error("用法:node scripts/register-industry-template.mjs --id <模板id> --name <名称> [--category 制造业] [--description ...] [--tags a,b] [--base http://localhost:3210]");
  process.exit(1);
}

const root = path.resolve(process.cwd(), args.dir ?? `vendor/industry-templates/${templateId}`);
const base = (args.base ?? "http://localhost:3210").replace(/\/+$/, "");

/** 递归收集模板目录下的资源(排除入口 HTML 本身——它单独作为 html 字段传)。 */
async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full, out);
      continue;
    }
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (relative === "index.html") continue;
    out.push({ relative, full });
  }
  return out;
}

const files = await collect(root);
const html = await readFile(path.join(root, "index.html"), "utf8");
const assets = {};
const binaryAssets = {};

for (const file of files) {
  const ext = path.extname(file.relative).toLowerCase();
  const buffer = await readFile(file.full);
  if (buffer.byteLength > 2_000_000) {
    console.warn(`  跳过(>2MB):${file.relative}`);
    continue;
  }
  if (TEXT_EXT.has(ext)) {
    assets[file.relative] = buffer.toString("utf8");
  } else if (MIME_BY_EXT[ext]) {
    binaryAssets[file.relative] = `data:${MIME_BY_EXT[ext]};base64,${buffer.toString("base64")}`;
  } else {
    console.warn(`  跳过(未知类型 ${ext || "无扩展名"}):${file.relative}`);
  }
}

const slots = [...html.matchAll(/data-sitecraft-slot\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
console.log(`模板 ${templateId}:${Object.keys(assets).length} 个文本资源、${Object.keys(binaryAssets).length} 个二进制资源`);
console.log(`  槽位 ${slots.length} 处:${[...new Set(slots.map((s) => s.split(".").slice(0, 2).join(".")))].join(", ")}`);

const response = await fetch(`${base}/api/templates/runtime`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-sitecraft-role": "editor" },
  body: JSON.stringify({
    templateId,
    name: args.name ?? templateId,
    category: args.category ?? "制造业",
    description: args.description ?? `${templateId}(行业模板)`,
    html,
    assets,
    binaryAssets,
    tags: (args.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }),
});

const payload = await response.json().catch(async () => ({ raw: await response.text() }));
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(payload, null, 2));
process.exit(response.ok ? 0 : 1);
