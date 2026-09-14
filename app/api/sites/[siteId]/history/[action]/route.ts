import { moveHistory, snapshot } from "@/lib/site-store";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string; action: string }> }) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { siteId, action } = await params;
  if (action !== "undo" && action !== "redo") return Response.json({ error: "Unknown history action" }, { status: 404 });
  const result = await moveHistory(siteId, action);
  return Response.json({ status: result.status, ...(result.status === "applied" ? { changeSet: result.changeSet, appliedTargets: result.appliedTargets } : {}), ...snapshot(result.record) });
}
