import { getPublishedRelease } from "@/lib/release-store";

export const runtime = "nodejs";

const siteKeyPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ siteKey: string }> }) {
  const { siteKey } = await params;
  if (!siteKeyPattern.test(siteKey)) return Response.json({ error: "invalid_site_key" }, { status: 400 });
  const release = await getPublishedRelease(siteKey);
  return release
    ? Response.json({ release }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "published_not_found", message: "当前站点还没有已发布版本。" }, { status: 404 });
}
