import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getTemplate } from "./site-model.ts";

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

const templateResourceAttributePattern = /((?:\b(?:src|poster|component-url|renderer-url))\s*=\s*["'])\/(?!\/|api\/)/gi;

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
  return rewritten;
}

export function getTemplateStaticRoot(templateId: string) {
  const template = getTemplate(templateId);
  if (template.id !== templateId) return null;
  if (!template.source.localPath) return null;
  const sourceRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), template.source.localPath);
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
  const template = getTemplate(templateId);
  if (template.id !== templateId) return null;
  if (!template.source.localPath) return null;
  const sourceRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), template.source.localPath);
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
