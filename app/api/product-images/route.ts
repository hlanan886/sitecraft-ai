// 产品图上传：POST /api/product-images 收文件存本地 → { url }。
import { NextRequest, NextResponse } from "next/server";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  storeOptimizedImage,
} from "@/lib/product-image-store";

/**
 * 上传一张产品图 → `{ url }`。校验 mime 白名单 + 大小上限，**并自动瘦身**。
 *
 * ## 为什么要瘦身（2026-09-11 实测）
 *
 * 盘点发现 12 张被引用的产品图占了 **20.3MB**——上游原样存了 1.7–2.3MB 的 PNG，
 * 而那些图在页面上的展示尺寸只有 400×300 左右。访客打开站点要下十几 MB，
 * 首屏直接卡住。**这不是优化项，是功能缺陷。**
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "无法解析上传表单" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return NextResponse.json({ error: `仅支持 ${ALLOWED_IMAGE_MIME.map((m) => m.split("/")[1]).join("/")} 图片` }, { status: 415 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图片超过 5MB 上限" }, { status: 413 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { url, savedBytes, optimized } = await storeOptimizedImage(buffer, file.type, file.name);
    return NextResponse.json({
      ok: true,
      url,
      // 如实告诉调用方我们动了什么——但**不阻塞**：压缩失败时 optimized=false 且 url 照常可用
      optimized,
      savedBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "存储失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
