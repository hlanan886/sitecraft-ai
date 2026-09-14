import { NextResponse } from "next/server";
import { getLeadStore, normalizeLeadPayload } from "@/lib/lead-store";

export const runtime = "nodejs";

const siteKeyPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> },
) {
  const { siteKey } = await params;
  if (!siteKeyPattern.test(siteKey)) {
    return NextResponse.json({ ok: false, error: "invalid_site_key" }, { status: 400 });
  }
  const parsed = normalizeLeadPayload(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.honeypot) {
    return NextResponse.json({ ok: true, status: "accepted" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await getLeadStore().create({ ...parsed.data, siteKey, source: "published" });
    return NextResponse.json(
      {
        ok: true,
        lead: {
          id: result.lead.id,
          siteKey: result.lead.siteKey,
          status: result.lead.status,
          createdAt: result.lead.createdAt,
        },
      },
      { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("public lead submission failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "lead_store_unavailable" }, { status: 503 });
  }
}
