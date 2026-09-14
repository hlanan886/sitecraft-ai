import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { createTemplateFromUrl } from "@/lib/template-from-url";
import { advanceJob, failJob, finishJob, startJob } from "@/lib/pending-job";
import { persistLibraryAssets } from "@/lib/template-static-export-browser";
import { storeImage } from "@/lib/product-image-store";
import { createSite } from "@/lib/site-store";
import { siteDraftSchema } from "@/lib/site-document";
import { defaultDraft } from "@/lib/site-model";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().url().max(2000),
  suffix: z.string().max(20).regex(/^[a-z0-9-]*$/i, "后缀只允许字母数字与短横线").optional(),
  /** 是否顺带建一个站（默认 false——A 的产出是"能看的静态页"，通常先看再决定） */
  createSite: z.boolean().optional(),
  siteName: z.string().min(1).max(100).optional(),
  /** 是否沉淀素材库（默认 true） */
  collectLibrary: z.boolean().optional(),
});

/**
 * 网址 → 静态模板（A 路径）。
 *
 * ## 与 `/api/templates/from-screenshot`（B 路径）的分工
 *
 * | | 本接口（A） | from-screenshot（B） |
 * |---|---|---|
 * | 输入 | 一个网址 | 一张截图 |
 * | 做法 | 抓下来**原样搬** | 模型读结构**重新拼** |
 * | 保真度 | 100% | 「大致像」 |
 * | 可编辑 | **有限**（只补得到 h1/mailto 这类） | 每个字段都有槽位 |
 * | 模型成本 | **0** | 一次多模态调用 |
 *
 * ## ⚠️ 为什么这里必须带 `skipQualityGate`
 *
 * 入库质量门要求「至少一个集合槽」（features/services/products 任一）。
 * 而**搬来的站天然没有槽位**——原站是用 `article`/`li`/`div` 排的版，
 * 槽位补全模块**刻意拒绝猜**集合容器（挑错容器会让编辑落在错误节点上）。
 *
 * 所以 A 的产出必然过不了那道门。这是**机制性的**，不是这次没做好。
 *
 * 带 `skipQualityGate` 的代价是真实的：模板会被标成 `recommendation: "isolated"`，
 * **不会被 AI 自动推荐**。这正是我们要的——A 是"今天就要个能看的站"的交付物，
 * 不是可以卖给客户长期维护的模板。**把它和 B 的产物混为一谈才是危险的。**
 */
export async function POST(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { url, suffix, createSite: shouldCreateSite = false, siteName, collectLibrary } = parsed.data;

  // ---- ⓪ 记一个"进行中的活儿"（断点恢复用，与 from-screenshot 同一套） ----
  const job = await startJob("template-from-url", { source: { kind: "url", url }, suffix });

  // ---- ① 抓 + 本地化 + 清洗 ----
  await advanceJob(job.jobId, "reading");
  const generated = await createTemplateFromUrl({ url, suffix, collectLibrary });
  if (!generated.ok) {
    const status = generated.step === "capture" ? 502 : 422;
    await failJob(job.jobId, { message: generated.message, detail: generated.detail });
    return Response.json(
      { error: `url_${generated.step}_failed`, message: generated.message, detail: generated.detail, jobId: job.jobId },
      { status },
    );
  }
  const { bundle, capture } = generated;

  // ---- ② 素材沉淀（把这个站的产品图/主视觉存进素材库，以后建站能直接挑） ----
  let libraryStored: Array<{ role: string; url: string }> = [];
  if (bundle.library.length > 0) {
    const stored = await persistLibraryAssets(bundle.library, storeImage);
    libraryStored = stored.filter((item) => item.storedUrl).map((item) => ({ role: item.role, url: item.storedUrl }));
  }

  // ---- ③ 登记（转调现有入口；A 的产物必须跳过槽位门，理由见上方注释） ----
  await advanceJob(job.jobId, "registering");
  const registerUrl = new URL("/api/templates/runtime", request.url);
  const registerResponse = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 访问上下文三头**必须原样带过去**：`/api/templates/runtime` 会**自己**再鉴权一次，
      // 而 strict 态下三个头缺任一即 401（`lib/request-context.ts:97`）。
      // ⚠️ 此前只转了 role + actor-id、漏了 workspace-id → 登记在**生产默认的
      // strict 态**下必然 401，用户看到"模板没能登记进模板库"。relaxed（开发/e2e）
      // 不检查这两个头，所以 e2e 一直是绿的——这正是它没被发现的原因。
      ...(request.headers.get("x-sitecraft-workspace-id") ? { "x-sitecraft-workspace-id": request.headers.get("x-sitecraft-workspace-id") as string } : {}),
      ...(request.headers.get("x-sitecraft-role") ? { "x-sitecraft-role": request.headers.get("x-sitecraft-role") as string } : {}),
      ...(request.headers.get("x-sitecraft-actor-id") ? { "x-sitecraft-actor-id": request.headers.get("x-sitecraft-actor-id") as string } : {}),
    },
    body: JSON.stringify({
      templateId: bundle.templateId,
      name: bundle.name,
      category: bundle.category,
      description: bundle.description,
      html: bundle.html,
      // 资源以**相对路径**引用（assets/xxx.jpg），登记接口按同名相对路径落盘，
      // 服务端资源路由也按同一相对路径读回来（已核实对运行时模板生效）。
      assets: bundle.assets,
      binaryAssets: bundle.binaryAssets,
      tags: ["网址搬站", "静态"],
      // 必须跳门：搬来的站没有集合槽，见文件顶部说明
      skipQualityGate: true,
    }),
  });
  const registerPayload = (await registerResponse.json().catch(() => null)) as
    | { error?: string; message?: string; slots?: string[] }
    | null;

  if (registerResponse.status === 409) {
    await failJob(job.jobId, { message: `${bundle.templateId} 这个名字已经有了，换一个再试。` });
    return Response.json(
      { error: "template_id_taken", message: `${bundle.templateId} 这个名字已经有了，换一个再试。`, retryable: true, jobId: job.jobId },
      { status: 409 },
    );
  }
  if (!registerResponse.ok) {
    return Response.json(
      {
        error: "template_register_failed",
        message: registerPayload?.message ?? "模板没能登记进模板库。",
        templateId: bundle.templateId,
      },
      { status: 422 },
    );
  }

  const shared = {
    ok: true,
    templateId: bundle.templateId,
    slots: registerPayload?.slots ?? [],
    summary: bundle.summary,
    warnings: bundle.warnings,
    stats: bundle.stats,
    siteName: capture.title || bundle.name,
    library: libraryStored,
    /** A 的产物**可编辑程度有限**——这个字段让前端能如实告知，而不是让客户自己发现 */
    editable: (registerPayload?.slots ?? []).length,
  };

  // ---- ④ 建站（可选） ----
  if (!shouldCreateSite) {
    await finishJob(job.jobId, { templateId: bundle.templateId, siteId: null, summary: bundle.summary });
    return Response.json({ ...shared, siteId: null, jobId: job.jobId }, { status: 201 });
  }

  ensureRuntimeTemplateManifests();
  // A 没有"模型生成的内容"，用默认草稿 + 站点名——页面本身是搬来的那份 HTML，
  // 草稿只影响工作台里能编辑的那几个字段（本来就有限）。
  const draft = siteDraftSchema.safeParse({
    ...structuredClone(defaultDraft),
    siteName: siteName ?? capture.title ?? bundle.name,
    companyName: siteName ?? capture.title ?? bundle.name,
    templateId: bundle.templateId,
    locale: "zh",
  });
  if (!draft.success) {
    return Response.json(
      { ...shared, siteId: null, error: "draft_invalid", message: "模板已可用，但建站草稿没通过校验。" },
      { status: 422 },
    );
  }

  try {
    const created = await createSite({
      name: siteName ?? capture.title ?? bundle.name,
      templateId: bundle.templateId,
      locales: ["zh"],
      initialDraft: draft.data,
    });
    await finishJob(job.jobId, { templateId: bundle.templateId, siteId: created.id, summary: bundle.summary });
    return Response.json({ ...shared, siteId: created.id, jobId: job.jobId }, { status: 201 });
  } catch (error) {
    const message = `站搬下来了，建站时却出错了：${error instanceof Error ? error.message : "未知错误"}`;
    await failJob(job.jobId, { message });
    return Response.json(
      { ...shared, siteId: null, error: "site_create_failed", message, jobId: job.jobId },
      { status: 422 },
    );
  }
}
