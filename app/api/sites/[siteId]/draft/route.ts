import { z } from "zod";
import { siteDraftSchema } from "@/lib/site-document";
import { siteOperationSchema } from "@/lib/site-operations";
import { commitOperations, getSite, snapshot } from "@/lib/site-store";

export const runtime = "nodejs";

const updateSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(siteOperationSchema).min(1).max(25),
  summary: z.string().min(1).max(500),
  source: z.enum(["import", "manual", "migration", "template"]),
});

export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return Response.json(await getSite(siteId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid draft update", details: parsed.error.flatten() }, { status: 400 });
  for (const operation of parsed.data.operations) {
    if (operation.op === "replace_draft") {
      const validDraft = siteDraftSchema.safeParse(operation.draft);
      if (!validDraft.success) return Response.json({ error: "Invalid replacement draft", details: validDraft.error.flatten() }, { status: 400 });
      operation.draft = validDraft.data;
    }
  }
  const { siteId } = await params;
  try {
    const result = await commitOperations({ siteId, ...parsed.data });
    if (result.status === "conflict") return Response.json({ error: "revision_conflict", ...snapshot(result.record) }, { status: 409 });
    return Response.json({ status: result.status, ...(result.status === "applied" ? { changeSet: result.changeSet } : {}), ...snapshot(result.record) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Draft update failed" }, { status: 422 });
  }
}
