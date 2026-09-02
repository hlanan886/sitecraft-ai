import { NextResponse } from "next/server";
import { leadStatusSchema, isLeadStoreEnabled, postgresLeadStore } from "@/lib/lead-store";

export const runtime = "nodejs";

function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status: 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteKey = url.searchParams.get("siteKey")?.trim() ?? "";
  if (!siteKey) return badRequest("site_key_required");
  const statusValue = url.searchParams.get("status")?.trim() || undefined;
  const status = statusValue ? leadStatusSchema.safeParse(statusValue) : { success: true as const, data: undefined };
  if (!status.success) return badRequest("invalid_status", status.error.flatten());
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return badRequest("invalid_limit", { min: 1, max: 100 });
  if (!isLeadStoreEnabled()) return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  try {
    const leads = await postgresLeadStore.list({ siteKey, status: status.data, limit });
    return NextResponse.json(
      { ok: true, leads, total: leads.length, newCount: leads.filter((lead) => lead.status === "new").length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("lead list failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  }
}
