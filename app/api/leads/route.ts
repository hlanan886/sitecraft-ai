import { NextResponse } from "next/server";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { leadStatusSchema, getLeadStore } from "@/lib/lead-store";

export const runtime = "nodejs";

function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status: 400 });
}

export async function GET(request: Request) {
  const access = authorizeRequest(request, "leads:read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const url = new URL(request.url);
  const siteKey = url.searchParams.get("siteKey")?.trim() ?? "";
  if (!siteKey) return badRequest("site_key_required");
  const statusValue = url.searchParams.get("status")?.trim() || undefined;
  const status = statusValue ? leadStatusSchema.safeParse(statusValue) : { success: true as const, data: undefined };
  if (!status.success) return badRequest("invalid_status", status.error.flatten());
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return badRequest("invalid_limit", { min: 1, max: 100 });
  try {
    const store = getLeadStore();
    const leads = await store.list({ siteKey, status: status.data, limit });
    // `newCount` 必须是**该站点全局**的新询盘数，不能从已按 status 过滤的结果里数——
    // 否则页面切到「已联系/已归档」时 KPI 恒显示 0（2026-09-10 修复）。
    // 仅在未过滤（即已拿到全量）时复用结果，否则单独查一次 new。
    const newCount = status.data
      ? (await store.list({ siteKey, status: "new", limit: 100 })).length
      : leads.filter((lead) => lead.status === "new").length;
    return NextResponse.json(
      { ok: true, leads, total: leads.length, newCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("lead list failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  }
}
