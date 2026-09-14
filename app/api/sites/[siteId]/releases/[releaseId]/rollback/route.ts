import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { requestIdempotency } from "@/lib/request-idempotency";
import { rollbackRelease } from "@/lib/release-store";
import { getSite } from "@/lib/site-store";

export const runtime = "nodejs";

const rollbackSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  publishedBy: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string; releaseId: string }> }) {
  const access = authorizeRequest(request, "rollback");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = rollbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid rollback payload", details: parsed.error.flatten() }, { status: 400 });
  const { siteId, releaseId } = await params;
  const scope = `rollback:${siteId}`;
  const key = parsed.data.idempotencyKey;
  if (key) {
    const decision = requestIdempotency.begin(scope, key);
    if (decision.status === "completed") return Response.json(decision.result, { headers: { "X-Idempotent-Replay": "true" } });
    if (decision.status === "inflight") return Response.json({ error: "request_inflight", message: "相同回滚请求正在处理中，请等待当前结果。" }, { status: 409 });
  }
  let current;
  try {
    current = await getSite(siteId);
  } catch (error) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: error instanceof Error ? error.message : "读取草稿失败" }, { status: 422 });
  }
  if (current.draft.revision !== parsed.data.baseRevision) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: "revision_conflict", message: "草稿已经更新，请刷新后再回滚。", revision: current.draft.revision }, { status: 409 });
  }
  try {
    const release = await rollbackRelease({ siteId, releaseId, publishedBy: parsed.data.publishedBy });
    const result = { status: "rolled_back", release };
    if (key) requestIdempotency.complete(scope, key, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (key) requestIdempotency.release(scope, key);
    const notFound = error instanceof Error && error.message === "release_not_found";
    return Response.json({ error: notFound ? "release_not_found" : "rollback_failed", message: notFound ? "历史发布版本不存在。" : error instanceof Error ? error.message : "回滚失败" }, { status: notFound ? 404 : 422 });
  }
}
