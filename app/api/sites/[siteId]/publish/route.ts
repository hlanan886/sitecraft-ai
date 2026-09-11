import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { evaluateDraftQuality } from "@/lib/content-quality";
import { requestIdempotency } from "@/lib/request-idempotency";
import { createRelease, getPublishedRelease } from "@/lib/release-store";
import { getSite } from "@/lib/site-store";
import { getTemplateManifest } from "@/lib/template-manifest";

export const runtime = "nodejs";

const publishSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  publishedBy: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  // 事实人工确认：用户核对生成内容中的数字/认证/性能声明后明确确认属实。
  // 确认后允许跳过 unverifiedFacts 类拦截；仍不豁免 missingSlots 等硬缺口。
  factsConfirmed: z.boolean().optional().default(false),
});

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { siteId } = await params;
  const release = await getPublishedRelease(siteId);
  return release
    ? Response.json({ status: "published", release }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "published_not_found", message: "当前站点还没有已发布版本。" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "publish");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid publish payload", details: parsed.error.flatten() }, { status: 400 });
  const { siteId } = await params;
  const scope = `publish:${siteId}`;
  const key = parsed.data.idempotencyKey;
  if (key) {
    const decision = requestIdempotency.begin(scope, key);
    if (decision.status === "completed") return Response.json(decision.result, { headers: { "X-Idempotent-Replay": "true" } });
    if (decision.status === "inflight") return Response.json({ error: "request_inflight", message: "相同发布请求正在处理中，请等待当前结果。" }, { status: 409 });
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
    return Response.json({ error: "revision_conflict", message: "草稿已经更新，请刷新后再发布。", draft: current.draft, revision: current.draft.revision }, { status: 409 });
  }
  const manifest = getTemplateManifest(current.draft.templateId);
  if (!manifest) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: "publish_blocked", message: "当前模板缺少内容契约，暂时不能发布。" }, { status: 422 });
  }
  const quality = evaluateDraftQuality(current.draft, manifest);
  if (!quality.publishable) {
    // 事实类声明（数字/认证/性能等）经用户显式确认属实后放行；结构性缺口（missingSlots 等）仍需补全。
    const factsOnly = quality.missingSlots.length === 0 && quality.overLimitSlots.length === 0
      && quality.placeholderHits.length === 0 && quality.languageMismatches.length === 0
      && quality.unverifiedFacts.length > 0 && parsed.data.factsConfirmed;
    if (!factsOnly) {
      if (key) requestIdempotency.release(scope, key);
      return Response.json({
        error: "publish_blocked",
        message: parsed.data.factsConfirmed && quality.unverifiedFacts.length > 0
          ? "发布前仍有内容需要处理（事实已确认，但存在其他待补全项）。"
          : quality.unverifiedFacts.length > 0 && !parsed.data.factsConfirmed
            ? "草稿包含待确认的数字/认证/性能等声明，请先人工核对后确认发布。"
            : "发布前仍有内容需要人工确认或补全。",
        quality,
        revision: current.draft.revision,
      }, { status: 422 });
    }
  }

  try {
    const release = await createRelease({
      siteId,
      draft: current.draft,
      expectedRevision: parsed.data.baseRevision,
      publishedBy: parsed.data.publishedBy,
    });
    const result = { status: "published", release };
    if (key) requestIdempotency.complete(scope, key, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (key) requestIdempotency.release(scope, key);
    const conflict = error && typeof error === "object" && "code" in error && error.code === "revision_conflict";
    return Response.json({ error: conflict ? "revision_conflict" : "publish_failed", message: error instanceof Error ? error.message : "发布失败" }, { status: conflict ? 409 : 422 });
  }
}
