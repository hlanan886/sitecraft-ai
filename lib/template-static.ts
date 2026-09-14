import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { findTemplate } from "./site-model.ts";
import { resolveWithinRepo } from "./template-runtime-loader.ts";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * 按扩展名推断 content-type。
 *
 * 导出给 `template-asset-mirror.ts` 复用——该模块此前对非 `.css` 一律返回
 * `application/octet-stream`，配上 `X-Content-Type-Options: nosniff`
 * 会让**镜像的图片被浏览器拒绝渲染**（2026-09-10 修复）。
 */
export function contentTypeForPath(filePath: string): string {
  return contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const templateResourceAttributePattern = /((?:\b(?:src|poster|component-url|renderer-url))\s*=\s*["'])\/(?!\/|api\/)/gi;

/**
 * 任意引号包裹的根级资源路径——用于 JS 字符串字面量与内联 CSS 的 url()。
 *
 * 为什么需要这条兜底（2026-09-09 实测）：
 * Astro/Vite 构建后的 JS 会把图片路径写成**纯字符串**，如 `src:"/assets/pilot-CA74Nnvm.png"`、
 * `"/_astro/testimonial-bg-01.webp"`。上面的 import()/fetch()/new URL() 规则认不出这种写法，
 * 于是请求打到站点根 → 404。实测受影响：yukina（9 处，整套 Swup 交互脚本）、
 * signal（5）、shadcn-landing（5）、foxi（2）、lonestone（2，内联 <style> 的字体 url()）、kindred（1）。
 *
 * 用「带已知资源扩展名」收口，避免误伤普通文案（如「见 /about 页」不含扩展名，不会被改）。
 * 负向断言排除：`//` 协议相对、`/api/`（本站接口）、已带 assetBase 的路径。
 */
const rootAssetLiteralPattern =
  /(["'`])\/(?!\/|api\/)([A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*\.(?:png|jpe?g|webp|gif|svg|avif|ico|bmp|css|mjs|js|cjs|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|xml|txt|pdf|webmanifest|vtt|map))(\?[^"'`]*)?(["'`])/gi;

/** 内联 CSS 的 url(/xxx)：单独一条，避免与上一条的引号处理互相干扰 */
const inlineCssUrlPattern =
  /(url\(\s*["']?)\/(?!\/|api\/)([^)"']+\.(?:png|jpe?g|webp|gif|svg|avif|ico|woff2?|ttf|otf|eot))(["']?\s*\))/gi;

/**
 * 无前导斜杠的相对资源路径——Vite 的 `__vite__mapDeps` 数组用这种写法。
 *
 * 实测来源：yukina 的 `dist/_astro/page.*.js` 把动态 import 的依赖写成
 * `m.f||(m.f=["_astro/SwupA11yPlugin.js","_astro/index.modern.js",...])`。
 * 这些是**独立 JS 资源**，不经过 prepareHtml，因此拿不到 <base> 修正；
 * 浏览器按文档 URL（`/api/templates/yukina/preview`）解析成
 * `/api/templates/yukina/_astro/...` → 404（实测 8 处）。
 *
 * 限定在已知资源目录前缀内，避免误伤普通字符串（如 `import("./mod.js")` 已被前面的
 * import 规则处理，且这里的 `(?!\.)` 排除 `./` 与 `../`）。
 */
const relativeAssetLiteralPattern =
  /(["'`])((?!\.)(?:_astro|assets|images|img|fonts|static|media|scripts)\/[A-Za-z0-9._@-]+\.(?:png|jpe?g|webp|gif|svg|avif|ico|bmp|css|mjs|js|cjs|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|xml|txt|pdf|webmanifest|vtt|map))(["'`])/gi;

/**
 * Rewrites root-relative references emitted by a static template so every
 * resource stays behind the template-scoped asset route inside the iframe.
 * Navigation hrefs are intentionally left untouched.
 */
export function rewriteTemplateRootRelativeReferences(
  source: string,
  contentType: string,
  assetBase: string,
) {
  const normalizedType = contentType.toLowerCase();
  if (!/^(?:text\/|application\/(?:javascript|json|x-javascript))/.test(normalizedType)) return source;

  let rewritten = source;
  if (normalizedType.includes("html")) {
    rewritten = rewritten.replace(templateResourceAttributePattern, `$1${assetBase}`);
    rewritten = rewritten.replace(/(<link\b[^>]*\bhref\s*=\s*["'])\/(?!\/|api\/templates\/)/gi, `$1${assetBase}`);
    rewritten = rewritten.replace(/(\bsrcset\s*=\s*["'])([^"']*)(["'])/gi, (_match, prefix: string, value: string, suffix: string) => {
      const candidates = value.replace(/(^|[\s,])\/(?!\/|api\/)/g, `$1${assetBase}`);
      return prefix + candidates + suffix;
    });
  }
  if (normalizedType.includes("css")) {
    rewritten = rewritten.replace(/(url\(\s*["']?)\/(?!\/|api\/)/gi, `$1${assetBase}`);
  }
  if (normalizedType.includes("javascript") || normalizedType.includes("x-javascript")) {
    rewritten = rewritten
      .replace(/(\b(?:import|importScripts|fetch)\(\s*["'])\/(?!\/|api\/)/gi, `$1${assetBase}`)
      .replace(/(\bnew\s+URL\(\s*["'])\/(?!\/|api\/)/gi, `$1${assetBase}`);
  }
  // 兜底：上面各分支漏掉的「引号包裹的根级资源路径」——JS 字符串字面量
  // （如 src:"/assets/x.png"）与内联 <style> 的 url()（见文件上方说明）。
  // 放在最后跑：已被前几条重写的路径都带 assetBase，负向断言会跳过，不会重复改写。
  rewritten = rewritten.replace(rootAssetLiteralPattern, (_m, open: string, p: string, query: string | undefined, close: string) => `${open}${assetBase}${p}${query ?? ""}${close}`);
  rewritten = rewritten.replace(inlineCssUrlPattern, `$1${assetBase}$2$3`);
  rewritten = rewritten.replace(relativeAssetLiteralPattern, `$1${assetBase}$2$3`);
  return rewritten;
}

/**
 * 解析模板的 localPath，**拒绝越界**。
 *
 * 抽成独立函数是因为现在有两条路径会喂给它：静态基线的 `vendor/...`，
 * 以及运行时沉淀模板的 `.sitecraft-data/generated-templates/<id>`。
 * 两者都必须过同一道防穿越检查——沉淀模板的目录名来自用户输入，
 * 若不做校验，一个叫 `../../..` 的目录就能把资源路由变成任意文件读取。
 *
 * 仓库根由 `template-runtime-loader.resolveWithinRepo` 统一判定（向上找
 * `package.json`），基线路径与运行时路径共用同一套规则——否则从子目录
 * （如 `node --test` 的 cwd）跑时，会出现「基线解析得到、沉淀模板解析不到」
 * 这种只在特定 cwd 下复现的错位。
 */
function parseTemplateRoot(localPath: string): string | null {
  return resolveWithinRepo(localPath);
}

export function getTemplateStaticRoot(templateId: string) {
  const template = findTemplate(templateId);
  if (!template) return null;
  if (!template.source.localPath) return null;
  const sourceRoot = parseTemplateRoot(template.source.localPath);
  if (!sourceRoot) return null;
  const distRoot = path.join(sourceRoot, "dist");
  if (existsSync(path.join(distRoot, "index.html"))) return distRoot;
  if (existsSync(path.join(sourceRoot, "index.html"))) return sourceRoot;
  // Next.js 静态导出产物（next build 输出到 .next/server/app/ 或 .next/server/pages/index.html）
  const nextAppRoot = path.join(sourceRoot, ".next", "server", "app");
  if (existsSync(path.join(nextAppRoot, "index.html"))) return nextAppRoot;
  const nextPagesRoot = path.join(sourceRoot, ".next", "server", "pages");
  if (existsSync(path.join(nextPagesRoot, "index.html"))) return nextPagesRoot;
  return null;
}

export async function readTemplateStaticFile(templateId: string, segments: string[]) {
  const template = findTemplate(templateId);
  if (!template) return null;
  if (!template.source.localPath) return null;
  const sourceRoot = parseTemplateRoot(template.source.localPath);
  if (!sourceRoot) return null;
  const root = getTemplateStaticRoot(templateId);
  if (!root) return null;
  const isNextAsset = segments[0] === "_next";
  const hasExportedNextAssets = isNextAsset && existsSync(path.join(root, "_next"));
  // 静态导出把 _next 放在 dist 内；仅旧式 server/app 入口需要映射回源码 .next。
  const base = isNextAsset && !hasExportedNextAssets ? path.join(sourceRoot, ".next") : root;
  const relativeSegments = isNextAsset && !hasExportedNextAssets ? segments.slice(1) : segments;
  const candidate = path.resolve(base, ...relativeSegments);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) return null;
  // GitHub Pages 类模板会在 HTML 里带一层虚拟基路径前缀（如 /astro-genai-startup-theme/），
  // 但本地 dist 物理结构没有这层目录。首段目录在根下不存在时，剥掉首段再试一次，
  // 让该前缀自然失效（仅对带 base path 构建的模板生效，不影响其他模板）。
  const withFallback = async (segmentsToUse: string[]) => {
    const cand = path.resolve(base, ...segmentsToUse);
    if (cand !== base && !cand.startsWith(`${base}${path.sep}`)) return null;
    let target = cand;
    try {
      const details = await stat(/* turbopackIgnore: true */ target);
      if (details.isDirectory()) target = path.join(target, "index.html");
      const body = await readFile(/* turbopackIgnore: true */ target);
      return { body, contentType: contentTypes[path.extname(target).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  };
  const direct = await withFallback(relativeSegments);
  if (direct) return direct;
  if (relativeSegments.length > 1) {
    const stripped = await withFallback(relativeSegments.slice(1));
    if (stripped) return stripped;
  }
  return null;
}
