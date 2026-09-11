// 产品图上传：POST /api/product-images 收文件存本地 → { url }。
import { NextRequest, NextResponse } from "next/server";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  storeImage,
} from "@/lib/product-image-store";

/** 上传一张产品图 → { url }。校验 mime 白名单 + 大小上限。 */
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
    const url = await storeImage(buffer, file.type, file.name);
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "存储失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
