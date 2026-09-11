import { readTemplateStaticFile, rewriteTemplateRootRelativeReferences } from "@/lib/template-static";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string; assetPath: string[] }> },
) {
  const { templateId, assetPath } = await params;
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
