import { z } from "zod";
import { siteDraftSchema } from "@/lib/site-document";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { createSite, listSites } from "@/lib/site-store";
import { allTemplates, defaultDraft } from "@/lib/site-model";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";

const createSiteSchema = z.object({
  name: z.string().min(1).max(100),
  templateId: z.string().refine((id) => allTemplates().some((template) => template.id === id)),
  locales: z.array(z.enum(["zh", "en"])).min(1),
  initialDraft: siteDraftSchema.optional(),
});

export async function POST(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  // 建站前把运行时模板的 manifest 也注册上：下面的白名单校验只会触发「模板记录」
  // 装载，若不补这一步，新沉淀的模板能建站、但工作台里拿不到槽位契约。
  ensureRuntimeTemplateManifests();
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
  // 2026-09-10：此前恒返 `[{id:"demo"}]`——首页因此永远看不到用户真正建的站。
  // 现列出本工作区的真实站点（文件存储扫 .sitecraft-data/sites，PG 查 sitecraft_sites）。
  //
  // 2026-09-14：支持 `?limit=N`。首页「最近的站点」只要最近几个——
  // 此前它渲染**全量**（实测工作区有 485 个站，绝大多数是 e2e 造的测试数据），
  // 页面被无用的历史站淹没。`listSites()` 已按 `updatedAt` 倒序，取前 N 即"最近"。
  // 不传 `limit` 时行为**完全不变**（工作台的站点列表依赖全量）。
  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam === null ? null : Number(limitParam);
  const all = await listSites();
  const sites = limit !== null && Number.isFinite(limit) && limit > 0 ? all.slice(0, Math.floor(limit)) : all;
  return Response.json(
    { sites, total: all.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
