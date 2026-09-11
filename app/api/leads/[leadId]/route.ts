import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { isLeadStoreEnabled, leadStatusSchema, postgresLeadStore } from "@/lib/lead-store";

export const runtime = "nodejs";

const updateSchema = z.object({
  siteKey: z.string().trim().min(1).max(80),
  status: leadStatusSchema,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const access = authorizeRequest(request, "leads:write");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { leadId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  if (!isLeadStoreEnabled()) return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  try {
    const lead = await postgresLeadStore.updateStatus({ leadId, ...parsed.data });
    if (!lead) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, lead }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("lead status update failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  }
}
