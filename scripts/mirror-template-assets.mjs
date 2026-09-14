/**
 * 模板境外资源本地化：扫描 → 下载 → 生成登记表。
 *
 * 用法：
 *   node scripts/mirror-template-assets.mjs            # 扫描并报告（不下载）
 *   node scripts/mirror-template-assets.mjs --write     # 下载并写入登记表
 *   node scripts/mirror-template-assets.mjs --only=astrowind,yukina
 *
 * 背景见 lib/template-asset-mirror.ts 头部。判定标准：**缺了它版式就坏**。
 * 因此只抓「图片 / 关键 CSS」；交互增强 JS、字体、非渲染 meta 不抓（缺了只是降级）。
 *
 * 生成物：
 *   vendor/template-assets/<templateId>/...   资源文件
 *   并打印可直接粘进 lib/template-asset-mirror.ts 的条目（人工复核后提交）
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEMPLATES_ROOT = path.join(ROOT, "vendor", "open-source-templates");
const MIRROR_ROOT = path.join(ROOT, "vendor", "template-assets");

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean) : null;

/**
 * 目录名 → catalog id 映射。
 *
 * **必须用 catalog id 做登记键**，因为运行时 `rewriteExternalResourceReferences(html, templateId)`
 * 传的是 catalog id（`app/api/templates/[templateId]/preview/route.ts`），
 * 而 vendor 目录名有 6 处与 id 不一致（astrowind→lonestone、odyssey→kindred、
 * astroplate→atlas、ricofast→signal、tailcast→astro-starter、small-bis→forge）。
 * 写错会导致**运行时静默不替换**（单元测试还可能通过）。
 */
async function loadCatalogIdMap() {
  const source = await readFile(path.join(ROOT, "lib", "template-catalog.ts"), "utf8");
  const map = new Map();
  // 每个条目形如 `{\n    id: "xxx",\n    ...\n    source: { ... localPath: "vendor/open-source-templates/<dir>" ... },\n  },`
  // 按 id 出现的位置向后找最近的 localPath（同一对象内），比按大括号切块稳。
  const idPattern = /\n\s*id:\s*"([a-z0-9-]+)",/g;
  const matches = [...source.matchAll(idPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const id = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? source.length : source.length;
    const localPath = source.slice(start, end).match(/localPath:\s*"vendor\/open-source-templates\/([a-z0-9-]+)"/)?.[1];
    if (localPath) map.set(localPath, id);
  }
  return map;
}

/**
 * 要镜像的域名白名单（与 catalog 的 localPath 无关——这里按 vendor 目录名扫）。
 * 图片是首要目标；CSS 只抓「缺了版式就坏」的（如 tailwind 全量类）。
 * 有意**不抓**：交互 JS（swiper/scrollreveal/flowbite）、字体（googleapis/gstatic）、
 * 图标库（iconify）、非渲染 meta（og:image 用的 cloudinary）。
 */
const IMAGE_HOSTS = ["images.unsplash.com", "s2.loli.net", "res.cloudinary.com"];
const CSS_HOSTS = ["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"];

/** 从 HTML 里抽出所有 http(s) 外链（跳过非渲染资源，如 og:image / twitter:image） */
function extractExternalUrls(html) {
  // 挖掉非渲染元数据。两种形态都要处理：
  //  1. 字面 `<meta property="og:image" content="...">`
  //  2. Next.js RSC payload 里转义的 `\"property\":\"og:image\",\"content\":\"...\"`
  //     —— 只过滤 (1) 会漏掉 (2)，实测 shadcn-landing2 就因此把 og:image 当成图片下载。
  const withoutMeta = html
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/\\"property\\":\\"og:image\\"[^}]*/gi, "")
    .replace(/\\"name\\":\\"twitter:image\\"[^}]*/gi, "");
  const urls = new Set();
  for (const match of withoutMeta.matchAll(/https?:\/\/[^"'`\s),\\]+/g)) {
    let url = match[0].replace(/&amp;/g, "&");
    // 相邻 URL 粘连（源 HTML 的 srcset 缺分隔符）时只取第一个
    const secondHttp = url.indexOf("http", 4);
    if (secondHttp !== -1) url = url.slice(0, secondHttp);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    // 跳过裸主机名（rel=preconnect/prefetch 之类），它们没有可下载的资源
    if (!parsed.pathname || parsed.pathname === "/") continue;
    // 跳过 og/twitter 图片路径（即便没被上面的规则挖掉，也不该镜像）
    if (/og-image|og_images|\/og\//i.test(parsed.pathname)) continue;
    urls.add(url);
  }
  return [...urls];
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** 图片：按「去尺寸参数」的 base URL 归并（Unsplash 同一张图有十几个 w/h 变体） */
function imageBaseKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** 本地文件名：尽量可读且稳定 */
function localFileName(url) {
  const parsed = new URL(url);
  const base = path.basename(parsed.pathname) || "asset";
  if (parsed.host === "images.unsplash.com") {
    // photo-1516996087931-5ae405802f9f → 保留即可（已是稳定唯一 id）
    return `${base}.jpg`;
  }
  if (base.includes(".")) {
    // CSS/其它：直接用文件名，避免同目录重复
    return base;
  }
  // 其余按 host 建子目录，避免同名覆盖
  const safeHost = parsed.host.replace(/[^a-z0-9.-]/gi, "_");
  return `${safeHost}/${base}`;
}

/**
 * 前缀 = origin + pathname（**去掉 query**）。
 *
 * 关键：Unsplash/Swiper 这类资源把尺寸写在 query 里
 * （`?w=400&h=225` / `?w=640&h=360`），同一张图有十几个变体。
 * 只有按「去掉 query 的前缀」匹配，一个本地文件才能覆盖该图的**全部尺寸**；
 * 否则 astrowind 首页 46 个 URL 会退化成 46 次下载（实测真实图片只有 8 张）。
 */
function assetPrefix(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function fetchBinary(url, { timeoutMs = 30_000 } = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Sitecraft-Asset-Mirror/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function scanTemplate(templateDir, catalogId) {
  const dirName = path.basename(templateDir);
  const templateId = catalogId ?? dirName;
  const indexPath = path.join(templateDir, "dist", "index.html");
  const fallback = path.join(templateDir, "index.html");
  const file = existsSync(indexPath) ? indexPath : existsSync(fallback) ? fallback : null;
  if (!file) return null;

  const html = await readFile(file, "utf8");
  const urls = extractExternalUrls(html);

  const images = new Map(); // prefix → { url, prefix, file }
  const css = [];
  for (const url of urls) {
    const host = hostOf(url);
    if (IMAGE_HOSTS.includes(host)) {
      const prefix = assetPrefix(url);
      if (!images.has(prefix)) images.set(prefix, { url, prefix, file: localFileName(url) });
    } else if (CSS_HOSTS.includes(host) && url.endsWith(".css")) {
      const prefix = assetPrefix(url);
      if (!css.some((item) => item.prefix === prefix)) css.push({ url, prefix, file: localFileName(url) });
    }
  }
  return { templateId, dirName, file, images: [...images.values()], css };
}

async function main() {
  const entries = await readdirSafe(TEMPLATES_ROOT);
  const catalogIdMap = await loadCatalogIdMap();
  const targets = only ? entries.filter((e) => only.includes(e)) : entries;

  const report = [];
  for (const dirName of targets) {
    const catalogId = catalogIdMap.get(dirName) ?? dirName;
    if (catalogId !== dirName) {
      console.log(`（目录 ${dirName} → catalog id ${catalogId}，按 id 登记）`);
    }
    const scanned = await scanTemplate(path.join(TEMPLATES_ROOT, dirName), catalogId);
    if (!scanned) continue;
    if (!scanned.images.length && !scanned.css.length) continue;
    report.push(scanned);
  }

  if (!report.length) {
    console.log("没有发现需要镜像的境外资源。");
    return;
  }

  console.log(`发现 ${report.length} 个模板有境外资源：\n`);
  for (const item of report) {
    console.log(`${item.templateId}: ${item.images.length} 张图, ${item.css.length} 个 CSS`);
    for (const image of item.images) console.log(`    图 ${image.url}\n      → ${image.file}`);
    for (const sheet of item.css) console.log(`    CSS ${sheet.url}\n      → ${sheet.file}`);
  }

  const lines = [];
  if (shouldWrite) {
    console.log("\n开始下载…\n");
  }
  for (const item of report) {
    for (const asset of [...item.images, ...item.css]) {
      const target = path.join(MIRROR_ROOT, item.templateId, asset.file);
      try {
        if (!shouldWrite) {
          // 只扫描模式：报告文件是否已落盘
          console.log(`  ${existsSync(target) ? "=" : "!"} ${item.templateId}/${asset.file}${existsSync(target) ? "" : "  ← 缺文件"}`);
        } else if (existsSync(target)) {
          console.log(`  = 已存在 ${item.templateId}/${asset.file}`);
        } else {
          const buffer = await fetchBinary(asset.url);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, buffer);
          console.log(`  + ${item.templateId}/${asset.file} (${(buffer.length / 1024).toFixed(0)}KB)`);
        }
        lines.push(`    { urlPrefix: ${JSON.stringify(asset.prefix)}, file: ${JSON.stringify(asset.file)} },`);
      } catch (error) {
        console.log(`  ✗ 下载失败 ${asset.url} — ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  console.log("\n=== 登记条目（复制进 lib/template-asset-mirror.ts 的 MIRRORED_ASSETS）===\n");
  for (const item of report) {
    console.log(`  ${JSON.stringify(item.templateId)}: [`);
    for (const asset of [...item.images, ...item.css]) {
      console.log(`    { urlPrefix: ${JSON.stringify(asset.prefix)}, file: ${JSON.stringify(asset.file)} },`);
    }
    console.log("  ],");
  }
}

async function readdirSafe(dir) {
  try {
    const { readdir } = await import("node:fs/promises");
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
