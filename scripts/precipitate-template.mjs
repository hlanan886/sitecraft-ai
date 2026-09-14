#!/usr/bin/env node
/**
 * 沉淀一个磁盘上的静态站为运行时模板（方向 3 阶段 A 的链路验证器）。
 *
 * 走**真实 HTTP** 调 `POST /api/templates/runtime`——不直接调库函数。
 * 理由与方向 1/2 的两次教训一致：单元测试全绿而真实链路不通的情况已经出现过两次
 * （别名错位、PG 占位符），而本阶段要验证的正是「HTTP → 落盘 → 注册 → 预览」这条链。
 *
 * 用法：
 *   node scripts/precipitate-template.mjs --from vendor/industry-templates/secttre \
 *     --id secttre --name "SECTTRE / Industrial Services" --category 制造业 \
 *     --description "工业服务企业官网，含服务、案例、客户与询价表单。" \
 *     [--base http://localhost:3210]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** 会作为文本资源上传的扩展名（其余二进制扩展名走 base64 通道）。 */
const TEXT_EXT = new Set([".css", ".js", ".mjs", ".cjs", ".json", ".txt", ".xml", ".webmanifest"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    out[key] = value;
  }
  return out;
}

/**
 * 递归收集模板目录下的文件。
 *
 * 排除项是刻意的：
 *   - `.git/`：secttre 自带一个 git 仓库，几百个对象文件会被全量上传；
 *   - `thumbnail.png`：模板库封面，不是渲染资源，1.2MB 纯浪费；
 *   - `README.md`：说明文档，不参与渲染。
 */
async function collectFiles(root) {
  const { readdir } = await import("node:fs/promises");
  const results = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (relative === "index.html") continue;
      results.push({ relative, full });
    }
  };
  await walk(root);
  return results;
}

const args = parseArgs(process.argv.slice(2));
const from = args.from;
const templateId = args.id;
if (!from || !templateId) {
  console.error("用法：node scripts/precipitate-template.mjs --from <目录> --id <模板id> --name <名称> [--category 制造业] [--description ...] [--base http://localhost:3210]");
  process.exit(1);
}

const root = path.resolve(process.cwd(), from);
const base = (args.base ?? "http://localhost:3210").replace(/\/+$/, "");

const files = await collectFiles(root);
const html = await readFile(path.join(root, "index.html"), "utf8");
const assets = {};
const binaryAssets = {};
let skipped = 0;

for (const file of files) {
  const ext = path.extname(file.relative).toLowerCase();
  if (path.basename(file.relative) === "thumbnail.png") {
    skipped += 1;
    continue;
  }
  const buffer = await readFile(file.full);
  // 阈值：单文件 2MB 以上多半是未压缩的大图，传上去也会拖慢模板装载；
  // 报告出来让人决定，而不是静默截断。
  if (buffer.byteLength > 2_000_000) {
    console.warn(`  跳过（>2MB）：${file.relative} (${(buffer.byteLength / 1e6).toFixed(1)}MB)`);
    skipped += 1;
    continue;
  }
  if (TEXT_EXT.has(ext)) {
    assets[file.relative] = buffer.toString("utf8");
  } else if (MIME_BY_EXT[ext]) {
    binaryAssets[file.relative] = `data:${MIME_BY_EXT[ext]};base64,${buffer.toString("base64")}`;
  } else {
    // 未知扩展名（README.md / LICENSE / .map 等）**不静默按 octet-stream 上传**：
    // 服务端对二进制资源有扩展名白名单（防绕开 index.html 的槽位补全），
    // 猜一个 MIME 只会换来一个 400。报告出来让人决定要不要加进白名单。
    console.warn(`  跳过（未知类型 ${ext || "无扩展名"}）：${file.relative}`);
    skipped += 1;
  }
}

console.log(`模板 ${templateId}：${Object.keys(assets).length} 个文本资源、${Object.keys(binaryAssets).length} 个二进制资源，跳过 ${skipped} 个`);

const response = await fetch(`${base}/api/templates/runtime`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-sitecraft-role": "editor" },
  body: JSON.stringify({
    templateId,
    name: args.name ?? templateId,
    category: args.category ?? "制造业",
    description: args.description ?? `${templateId}（沉淀模板）`,
    html,
    assets,
    binaryAssets,
    tags: (args.tags ?? "").split(",").filter(Boolean),
  }),
});

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = { raw: text.slice(0, 2000) };
}
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(payload, null, 2));
process.exit(response.ok ? 0 : 1);
