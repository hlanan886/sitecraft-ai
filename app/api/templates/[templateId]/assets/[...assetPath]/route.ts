import { readTemplateStaticFile, rewriteTemplateRootRelativeReferences } from "@/lib/template-static";
import { MIRROR_PATH_SEGMENT, readMirroredTemplateAsset } from "@/lib/template-asset-mirror";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string; assetPath: string[] }> },
) {
  const { templateId, assetPath } = await params;
  // 境外致命资源的本地镜像（见 lib/template-asset-mirror.ts）
  if (assetPath[0] === MIRROR_PATH_SEGMENT) {
    const mirrored = await readMirroredTemplateAsset(templateId, assetPath.slice(1));
    if (!mirrored) return new Response("Asset not found", { status: 404 });
    return new Response(new Uint8Array(mirrored.body), {
      headers: {
        "Content-Type": mirrored.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const asset = await readTemplateStaticFile(templateId, assetPath);
  if (!asset) return new Response("Asset not found", { status: 404 });
  const assetBase = `/api/templates/${encodeURIComponent(templateId)}/assets/`;
  const isTextAsset = /^(?:text\/|application\/(?:javascript|json|x-javascript))/.test(asset.contentType.toLowerCase());
  const body = isTextAsset
    ? Buffer.from(rewriteTemplateRootRelativeReferences(asset.body.toString("utf8"), asset.contentType, assetBase))
    : new Uint8Array(asset.body);
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
