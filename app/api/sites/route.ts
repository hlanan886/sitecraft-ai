import { z } from "zod";
import { siteDraftSchema } from "@/lib/site-document";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { createSite, getSite } from "@/lib/site-store";
import { defaultDraft, templates } from "@/lib/site-model";

const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  templateId: z.string().refine((id) => templates.some((template) => template.id === id)),
  locales: z.array(z.enum(["zh", "en"])).min(1),
  initialDraft: siteDraftSchema.optional(),
});

export async function POST(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = createSiteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid site payload", details: parsed.error.flatten() }, { status: 400 });
  const { name, templateId, locales } = parsed.data;
  const initialDraft = parsed.data.initialDraft ?? {
    ...structuredClone(defaultDraft),
    siteName: name,
    companyName: name,
    templateId,
    locale: locales[0],
  };
  try {
    const created = await createSite({ name, templateId, locales, initialDraft });
    return Response.json({ name, templateId, locales, status: "draft", ...created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Site creation failed" }, { status: 422 });
  }
}

export async function GET(request: Request) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  return Response.json({ sites: [{ id: "demo", ...(await getSite("demo")) }] }, { headers: { "Cache-Control": "no-store" } });
}
