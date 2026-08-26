import { moveHistory, snapshot } from "@/lib/site-store";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ siteId: string; action: string }> }) {
  const { siteId, action } = await params;
  if (action !== "undo" && action !== "redo") return Response.json({ error: "Unknown history action" }, { status: 404 });
  const result = await moveHistory(siteId, action);
  return Response.json({ status: result.status, ...(result.status === "applied" ? { changeSet: result.changeSet, appliedTargets: result.appliedTargets } : {}), ...snapshot(result.record) });
}
