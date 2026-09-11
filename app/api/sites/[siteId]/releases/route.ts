import { listReleases } from "@/lib/release-store";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { siteId } = await params;
  return Response.json({ releases: await listReleases(siteId) }, { headers: { "Cache-Control": "no-store" } });
}
