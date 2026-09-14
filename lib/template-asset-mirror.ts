import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { contentTypeForPath } from "./template-static.ts";

/**
 * 模板境外资源本地化。
 *
 * ## 背景（2026-09-09 起，2026-09-10 扩展）
 *
 * 22 个模板的首页资源里有境外 CDN 依赖。最致命的是 **tailwind-landing**：
 * 它的**全部 CSS** 来自 `unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css`，
 * 国内网络下浏览器 `net::ERR_CONNECTION_CLOSED`（curl 能通是因为走代理，浏览器不走），
 * 结果模板**零样式渲染**（竖排堆叠、SVG 撑满整屏）。
 *
 * 处置：把「必须可达才能正确渲染」的资源**镜像到仓库**（`vendor/template-assets/`），
 * 预览时把外部 URL 重写为模板作用域内的本地路径（复用 asset 路由的 `__mirror__/` 前缀）。
 *
 * ## 2026-09-10 三处扩展（此前只镜像了 1 个文件、且完全不碰图片）
 *
 * 1. **前缀匹配**：Unsplash 同一张照片有十几个尺寸变体
 *    （`?w=400`/`?w=500`/`?w=640`…）——按 base URL **前缀匹配**，
 *    一个本地文件即可覆盖该图的全部尺寸（astrowind 首页 46 个 URL 实为 8 张图）。
 * 2. **覆盖 `<img>` 等标签**：此前正则只匹配 `<link>`/`<script>`，
 *    **图片的绝对外链完全没有服务端重写入口**——这是国内访问失败的最大来源。
 *    现覆盖 `img|source|video|audio|input` 的 `src`/`srcset`/`poster`
 *    以及 yukina 用的 `data-background-image`。
 * 3. **修 content-type**：此前除 `.css` 外一律 `application/octet-stream`，
 *    配上 `X-Content-Type-Options: nosniff` → **镜像的图片会被浏览器拒绝渲染**。
 *    现复用 `template-static.ts` 的 `contentTypeForPath`。
 *
 * 判定标准只看「缺了它版式就坏」——交互增强 JS、非渲染 meta 一律不镜像。
 */
export type MirroredAssetEntry = {
  /** 外部 URL 前缀；命中该前缀的引用统一指向 `file`。 */
  urlPrefix: string;
  /** 仓库内相对 `vendor/template-assets/<templateId>/` 的文件路径（可含子目录）。 */
  file: string;
};

const MIRRORED_ASSETS: Record<string, readonly MirroredAssetEntry[]> = {
  "tailwind-landing": [
    // 模板自带 tailwind v2 全量工具类；缺它整站零样式
    { urlPrefix: "https://unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css", file: "tailwind.min.css" },
  ],
  // 以下由 `node scripts/mirror-template-assets.mjs --write` 抓取生成（2026-09-10）。
  // 三者是国内访问失败最严重的模板：首页图片全部来自境外 CDN。
  lonestone: [
    { urlPrefix: "https://images.unsplash.com/photo-1519389950473-47ba0277781c", file: "photo-1519389950473-47ba0277781c.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1600132806370-bf17e65e942f", file: "photo-1600132806370-bf17e65e942f.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1611462985358-60d3498e0364", file: "photo-1611462985358-60d3498e0364.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1616198814651-e71f960c3180", file: "photo-1616198814651-e71f960c3180.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1516996087931-5ae405802f9f", file: "photo-1516996087931-5ae405802f9f.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1637144113536-9c6e917be447", file: "photo-1637144113536-9c6e917be447.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1546984575-757f4f7c13cf", file: "photo-1546984575-757f4f7c13cf.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1534307671554-9a6d81f4d629", file: "photo-1534307671554-9a6d81f4d629.jpg" },
  ],
  "shadcn-landing2": [
    { urlPrefix: "https://images.unsplash.com/photo-1534528741775-53994a69daeb", file: "photo-1534528741775-53994a69daeb.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1527980965255-d3b416303d12", file: "photo-1527980965255-d3b416303d12.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1573497161161-c3e73707e25c", file: "photo-1573497161161-c3e73707e25c.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1616805765352-beedbad46b2a", file: "photo-1616805765352-beedbad46b2a.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e", file: "photo-1573497019940-1c28c88b4f3e.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1633332755192-727a05c4013d", file: "photo-1633332755192-727a05c4013d.jpg" },
    { urlPrefix: "https://images.unsplash.com/photo-1573497019236-17f8177b81e8", file: "photo-1573497019236-17f8177b81e8.jpg" },
  ],
  yukina: [
    { urlPrefix: "https://s2.loli.net/2025/01/25/PBvHFjr5yDu6t4a.webp", file: "PBvHFjr5yDu6t4a.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/6bKcwHZigzlM4mJ.webp", file: "6bKcwHZigzlM4mJ.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/H9WgEK6qNTcpFiS.webp", file: "H9WgEK6qNTcpFiS.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/njNVtuUMzxs81RI.webp", file: "njNVtuUMzxs81RI.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/tozsJ8QHAjFN3Mm.webp", file: "tozsJ8QHAjFN3Mm.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/Pm89OveZq7NWUxF.webp", file: "Pm89OveZq7NWUxF.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/UCYKvc1ZhgPHB9m.webp", file: "UCYKvc1ZhgPHB9m.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/JjpLOW8VSmufzlA.webp", file: "JjpLOW8VSmufzlA.webp" },
    { urlPrefix: "https://s2.loli.net/2025/01/25/FPpTrQSezM8ivbl.webp", file: "FPpTrQSezM8ivbl.webp" },
  ],
};

/** 镜像资源在 asset 路由里的前缀段，避免与模板自身资源路径冲突 */
export const MIRROR_PATH_SEGMENT = "__mirror__";

/** 安全取主机名（畸形 URL 返回空串）。 */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * 查找命中的镜像条目。**最长前缀优先**——避免 `https://a.com/` 这类宽前缀
 * 抢走 `https://a.com/b/` 这类更具体的条目。
 */
function findMirroredEntry(templateId: string, url: string): MirroredAssetEntry | undefined {
  const entries = MIRRORED_ASSETS[templateId];
  if (!entries?.length) return undefined;
  return entries
    .filter((entry) => url.startsWith(entry.urlPrefix))
    .sort((a, b) => b.urlPrefix.length - a.urlPrefix.length)[0];
}

export function mirroredAssetPath(templateId: string, url: string): string | undefined {
  return findMirroredEntry(templateId, url)?.file;
}

/** 某模板登记的全部镜像条目（诊断/体检用）。 */
export function mirroredAssetEntries(templateId: string): readonly MirroredAssetEntry[] {
  return MIRRORED_ASSETS[templateId] ?? [];
}

/**
 * 把 HTML 里已登记的外部资源引用重写为模板作用域的本地路径。
 *
 * 覆盖：`<link href>`、`<script src>`、`<img|source|video|audio|input>` 的
 * `src`/`srcset`/`poster`/`data-background-image`。未登记的 URL 原样保留（不改变现状）。
 */
export function rewriteExternalResourceReferences(html: string, templateId: string): string {
  const entries = MIRRORED_ASSETS[templateId];
  if (!entries?.length) return html;
  const assetBase = `/api/templates/${encodeURIComponent(templateId)}/assets/${MIRROR_PATH_SEGMENT}/`;

  // 已镜像的域名：对这些域名的**连接预热提示**（preconnect/dns-prefetch）应当移除——
  // 资源已本地化，预热一个连不上的境外域名在国内网络下会挂起等待，反而拖慢首屏。
  // 实例：astrowind 残留 `<link href="https://images.unsplash.com" rel="preconnect">`。
  const mirroredHosts = new Set(entries.map((entry) => safeHost(entry.urlPrefix)));
  let stripped = html.replace(
    /<link\b[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch)["']?[^>]*>/gi,
    (tag) => {
      const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      return mirroredHosts.has(safeHost(href)) ? "" : tag;
    },
  );

  // srcset 是多候选（`url1 400w, url2 800w`），逐候选替换；普通属性整串替换。
  // 用一条正则同时覆盖两种：先匹配整个属性值，再在回调里逐个 URL 处理。
  const attributePattern = /\b(src|srcset|poster|href|data-background-image)\s*=\s*(["'])([^"']*)\2/gi;
  const withAttributes = stripped.replace(attributePattern, (match, attribute: string, quote: string, value: string) => {
    if (!/^https?:\/\//i.test(value) && !/(?:^|,\s*)https?:\/\//i.test(value)) return match;
    const isSrcset = attribute.toLowerCase() === "srcset";
    let changed = false;
    const rewritten = value
      .split(",")
      .map((candidate) => {
        // 保留原始分隔与空白形态，避免把属性重排得面目全非
        const leading = candidate.match(/^\s*/)?.[0] ?? "";
        const trailing = candidate.match(/\s*$/)?.[0] ?? "";
        const core = candidate.trim();
        if (!core) return candidate;
        const [url, ...descriptor] = core.split(/\s+/);
        const entry = findMirroredEntry(templateId, url);
        if (!entry) return candidate;
        changed = true;
        const local = `${assetBase}${entry.file}`;
        return `${leading}${local}${descriptor.length ? ` ${descriptor.join(" ")}` : ""}${trailing}`;
      })
      .join(",");
    // 无命中时保持原样（避免无意义的属性重写）
    if (!changed) return match;
    return `${attribute}=${quote}${rewritten}${quote}`;
  });
  // RSC payload 也要重写：否则客户端 hydration 会把境外 URL 挂回 DOM
  return rewriteRscPayload(withAttributes, templateId, assetBase);
}

/**
 * 重写 **Next.js RSC payload** 里的境外资源。
 *
 * 为什么必须单独做一次：Next 静态导出（shadcn-landing2）的 HTML 里，
 * 图片 URL 会同时出现在两处——
 *   1. 真实 `<img src="...">`（上面的属性重写覆盖）
 *   2. RSC payload 的转义 JSON：`{"src":"https:\/\/images.unsplash.com\/photo-..."}`
 * 只改 (1) 的话，客户端 **hydration 时会把 (2) 里的境外 URL 重新挂回 DOM**，
 * 服务端好不容易本地化的图片又变回外链——实测 shadcn-landing2 正是如此。
 *
 * 两类形态都处理：
 *   - Next 惯用的 `src` 字段：`"src":"\u0068ttps:\/\/..."`
 *   - 通用绝对 URL 字符串：`"\u0068ttps:\/\/images.unsplash.com\/photo-..."`
 */
function rewriteRscPayload(html: string, templateId: string, assetBase: string): string {
  let out = html;
  // 形态 1：RSC 的 "src":"https:\/\/..."（按前缀命中，覆盖所有尺寸变体）
  out = out.replace(
    /("src"\s*:\s*")(https?:\\?\/\\?\/[^"\\]*(?:\\.[^"\\]*)*)(")/g,
    (match, head: string, encodedUrl: string, tail: string) => {
      const decoded = encodedUrl.replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
      const entry = findMirroredEntry(templateId, decoded);
      if (!entry) return match;
      // 保持原转义风格，避免破坏 RSC 的字符串边界
      return `${head}${assetBase.replace(/\//g, "\\/")}${entry.file}${tail}`;
    },
  );
  // 形态 2：任意被转义的绝对 URL 字符串（兜底，避免遗漏别的字段名）
  out = out.replace(
    /(https?:\\?\/\\?\/images\.unsplash\.com\\?\/[a-z0-9-]+)/gi,
    (url: string) => {
      const decoded = url.replace(/\\\//g, "/");
      const entry = findMirroredEntry(templateId, decoded);
      if (!entry) return url;
      return `${assetBase.replace(/\//g, "\\/")}${entry.file}`;
    },
  );
  return out;
}

/** 读取已镜像的模板资源；segments 为 `__mirror__/` 之后的路径段。 */
export async function readMirroredTemplateAsset(templateId: string, segments: string[]) {
  const entries = MIRRORED_ASSETS[templateId];
  if (!entries?.length || segments.length === 0) return null;
  // 只允许登记表里出现过的文件（fail-closed，且天然防路径穿越）
  const allowed = new Set(entries.map((entry) => entry.file));
  const requested = segments.join("/");
  if (!allowed.has(requested)) return null;
  const file = path.join(process.cwd(), "vendor", "template-assets", templateId, ...segments);
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  return {
    body: await readFile(/* turbopackIgnore: true */ file),
    contentType: contentTypeForPath(requested),
  };
}

/** 诊断用：列出某模板登记的外部资源及其本地文件是否存在。 */
export function mirroredAssetReport(templateId: string) {
  return mirroredAssetEntries(templateId).map((entry) => ({
    url: entry.urlPrefix,
    file: entry.file,
    present: existsSync(path.join(process.cwd(), "vendor", "template-assets", templateId, entry.file)),
  }));
}

/**
 * 全量体检：所有模板登记的镜像资源是否都已落盘。
 *
 * **接进启动/CI**——此前 `mirroredAssetReport` 是死代码，
 * 导致「表里有登记、文件却没下载」不会被发现，直到用户看到破图。
 */
export function mirroredAssetsHealth() {
  const missing: Array<{ templateId: string; url: string; file: string }> = [];
  for (const templateId of Object.keys(MIRRORED_ASSETS)) {
    for (const item of mirroredAssetReport(templateId)) {
      if (!item.present) missing.push({ templateId, url: item.url, file: item.file });
    }
  }
  return { missing, healthy: missing.length === 0 };
}

/** 供抓取脚本使用：把某模板的镜像登记写入（脚本生成，非运行时调用）。 */
export async function saveMirroredAsset(templateId: string, file: string, body: Buffer) {
  const target = path.join(process.cwd(), "vendor", "template-assets", templateId, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return target;
}
