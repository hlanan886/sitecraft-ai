import { readTemplateStaticFile } from "@/lib/template-static";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string; assetPath: string[] }> },
) {
  const { templateId, assetPath } = await params;
  const asset = await readTemplateStaticFile(templateId, assetPath);
  if (!asset) return new Response("Asset not found", { status: 404 });
  return new Response(new Uint8Array(asset.body), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
