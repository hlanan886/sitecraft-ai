// 读取已上传产品图：GET /api/product-images/{file} → 图片字节（本地盘）。
import { NextRequest, NextResponse } from "next/server";
import { readStoredImage } from "@/lib/product-image-store";

/** 按 /api/product-images/{file} 读回图片字节（本地盘）。 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const urlPath = `/api/product-images/${file}`;
  const buf = await readStoredImage(urlPath);
  if (!buf) {
    return new NextResponse("not found", { status: 404 });
  }
  // 由扩展名推断 content-type（避免把用户文件内容当类型来源）
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const mimeByExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
    svg: "image/svg+xml",
  };
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeByExt[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
