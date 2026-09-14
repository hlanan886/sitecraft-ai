/**
 * 产品图本地存储层。
 *
 * 设计（借鉴 Vercel Blob / Vendure 思路，但本地磁盘起步、不留云端债）：
 * - 文件落在 .sitecraft-data/uploads/（已 gitignore），文件名带随机后缀防碰撞。
 * - 对外 URL 走 /api/product-images/{file} 提供（App Router 动态路由可读本地盘，避开 next/image 缓存）。
 * - product.image 存的是该 URL 路径（/api/product-images/xxx.jpg）；渲染/导出统一经 URL 取。
 * - 演进到对象存储时只替换本模块内部实现，product 字段与渲染层零改动。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const uploadsRoot = path.join(process.cwd(), ".sitecraft-data", "uploads");

/**
 * 允许上传的图片类型（2026-09-11 P-2）。
 *
 * ⚠️ **`image/svg+xml` 已被移除**：SVG 是**可执行文档**，能内嵌 `<script>`。
 * 由本项目域名同源提供 = **存储型 XSS**（用户上传恶意 SVG → 他人打开
 * `/api/product-images/x.svg` → 脚本在我们的 origin 下执行）。
 * 产品图用不到矢量格式，故直接不放行；上传接口不再接受 `.svg`。
 *
 * 读取接口另有 `X-Content-Type-Options` + `CSP` 兜底，防止历史遗留文件与未来格式。
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
};

export const ALLOWED_IMAGE_MIME = Object.keys(EXT_BY_MIME);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

function extFor(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

function safeFileName(name: string): string {
  // 只保留字母数字与 ._-，避免路径穿越
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "image";
}

/** 存一张图，返回相对 URL 路径（如 /api/product-images/x.jpg）。 */
export async function storeImage(buffer: Buffer, mime: string, originalName: string): Promise<string> {
  const ext = extFor(mime);
  if (!ext) throw new Error(`不支持的类型: ${mime}`);
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName(path.parse(originalName).name)}${ext}`;
  await mkdir(uploadsRoot, { recursive: true });
  await writeFile(path.join(uploadsRoot, fileName), buffer);
  return `/api/product-images/${fileName}`;
}

/**
 * 存一张图，**先瘦身再落盘**（2026-09-11）。
 *
 * 为什么不改上面的 `storeImage`：它是纯存储原语，"存什么就是什么"。
 * 瘦身是**上传策略**，不是存储职责——混在一起会让"我只想原样存一张图"
 * 变成做不到的事（截图流程有时就要原图）。
 *
 * ⚠️ **扩展名必须跟着实际字节走**。压缩后是 WebP，文件名却还是 `.png`，
 * 服务端按扩展名推 content-type 会返回 `image/png`——浏览器拿到 WebP 字节
 * 却按 PNG 解析，**图片直接不显示**，而且不报错。
 */
export async function storeOptimizedImage(buffer: Buffer, mime: string, originalName: string): Promise<{ url: string; savedBytes: number; optimized: boolean }> {
  const { optimizeUploadedImage } = await import("./image-optimize.ts");
  const result = await optimizeUploadedImage(buffer, mime);
  // 用**压缩后**的 mime 取名，而不是上传时的 mime
  const url = await storeImage(result.buffer, result.mime, originalName);
  return { url, savedBytes: result.savedBytes, optimized: result.optimized };
}

/** 按 URL 路径读回文件；非法/不存在返回 null。 */
export async function readStoredImage(urlPath: string): Promise<Buffer | null> {
  if (!urlPath.startsWith("/api/product-images/")) return null;
  const fileName = path.basename(urlPath);
  const full = path.join(uploadsRoot, fileName);
  if (!full.startsWith(uploadsRoot)) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

/** 删除（返回是否删除）。 */
export async function deleteStoredImage(urlPath: string): Promise<boolean> {
  if (!urlPath.startsWith("/api/product-images/")) return false;
  const full = path.join(uploadsRoot, path.basename(urlPath));
  if (!full.startsWith(uploadsRoot)) return false;
  try {
    await unlink(full);
    return true;
  } catch {
    return false;
  }
}

export { uploadsRoot };
