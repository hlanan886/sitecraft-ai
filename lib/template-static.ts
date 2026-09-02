import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getTemplate } from "@/lib/site-model";

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
  // Next.js 构建产物中，HTML 在 .next/server/{app,pages}，静态资源在 .next/static。
  // 请求路径以 _next/ 开头（如 /assets/_next/static/...），磁盘实际路径是 .next/static/...，
  // 需剥掉 _next 前缀再映射到 .next 目录。
  const isNextAsset = segments[0] === "_next";
  const base = isNextAsset ? path.join(sourceRoot, ".next") : root;
  const candidate = path.resolve(base, ...(isNextAsset ? segments.slice(1) : segments));
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) return null;
  let target = candidate;
  try {
    const details = await stat(/* turbopackIgnore: true */ target);
    if (details.isDirectory()) target = path.join(target, "index.html");
    const body = await readFile(/* turbopackIgnore: true */ target);
    return { body, contentType: contentTypes[path.extname(target).toLowerCase()] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
