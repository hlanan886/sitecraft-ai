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
  const sourceRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), template.source.localPath);
  const distRoot = path.join(sourceRoot, "dist");
  if (existsSync(path.join(distRoot, "index.html"))) return distRoot;
  if (existsSync(path.join(sourceRoot, "index.html"))) return sourceRoot;
  return null;
}

export async function readTemplateStaticFile(templateId: string, segments: string[]) {
  const root = getTemplateStaticRoot(templateId);
  if (!root) return null;
  const candidate = path.resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
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
