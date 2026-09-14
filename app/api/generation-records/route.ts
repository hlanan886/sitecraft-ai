import { isGenerationRecordEnabled, listGenerationRecords, summarizeGenerationRecords } from "@/lib/generation-record";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";

export const runtime = "nodejs";

/** 导出生成存证（Q3）：返回最近 N 条，供人工抽查/质量回溯 */
export async function GET(request: Request) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const records = await listGenerationRecords(Number.isFinite(limit) ? limit : 50);
  return Response.json({ ok: true, enabled: isGenerationRecordEnabled(), count: records.length, metrics: summarizeGenerationRecords(records), records }, { headers: { "Cache-Control": "no-store" } });
}
