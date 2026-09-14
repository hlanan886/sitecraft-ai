import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { createTemplateFromScreenshot } from "@/lib/template-from-screenshot";
import { advanceJob, failJob, finishJob, startJob } from "@/lib/pending-job";
import { createSite } from "@/lib/site-store";
import { siteDraftSchema } from "@/lib/site-document";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";

export const runtime = "nodejs";

/**
 * 截图/网址 × 生成模板请求体。
 *
 * `source` 用 discriminated union 而不是"两个可选字段"：后者允许
 * `{ imageUrl: "…", url: "…" }` 这种既像又像的输入，而路由必须先猜用户要哪个。
 * 二选一写成类型层面的二选一，猜的工作就没了。
 */
const requestSchema = z.object({
  source: z.discriminatedUnion("kind", [
    /** 用户直接传的截图——先经 `POST /api/product-images` 存好，这里传回来的 URL */
    z.object({ kind: z.literal("upload"), urlPath: z.string().min(1).max(2000) }),
    /** 一个网址——服务端自己抓 */
    z.object({ kind: z.literal("url"), url: z.string().url().max(2000) }),
  ]),
  /** 用户补充的话（截图读不出来的信息） */
  note: z.string().max(2000).optional(),
  siteModel: z.enum(["corporate", "portfolio", "blog"]).optional(),
  /** 是否顺带建一个站（默认 true）——客户要的是"能看的站"，不是"一个模板文件" */
  createSite: z.boolean().optional(),
  /** 新站的名字（不给就用模板名） */
  siteName: z.string().min(1).max(100).optional(),
  /**
   * 顺带建站时给站一个可区分的名字后缀。
   *
   * 由**前端**给（时间戳/随机短码），不用 `Date.now()` 在服务端生成——
   * 服务端生成的话，同一个模板被登记两次会撞 id（`/api/templates/runtime` 对已存在 id 返 409），
   * 而"撞了 409"对客户是没有意义的错误。
   */
  suffix: z.string().max(20).regex(/^[a-z0-9-]*$/i, "后缀只允许字母数字与短横线").optional(),
  /** 从原站自动裁产品图（只有 `url` 来源有效） */
  withProductImages: z.boolean().optional(),
});

/**
 * 截图 → 模板（B 路径）。
 *
 * ## 这个接口做三件事，都是**复用现有的**
 *
 * ```
 * ① 图 → 一份可登记的产物      ← 新代码，全在 lib/template-from-screenshot.ts
 * ② 登记模板                  ← 转调 POST /api/templates/runtime（补槽位 + 质量门 + 热注册）
 * ③ 建站                      ← 直接调 lib/site-store 的 createSite
 * ```
 *
 * ②③ **故意不重写**：`/api/templates/runtime` 里有非重启热注册、写盘前的质量门、
 * 槽位补全——任何一样在别处重写都会与它漂移。转调虽然多一次 HTTP，
 * 但换来"这条链路和手工沉淀模板走的是同一扇门"，值得。
 *
 * ## 失败要说人话
 *
 * 自助场景下没有人兜底（计划 §13.4 铁律 1）——`createTemplateFromScreenshot`
 * 已经把每一步的失败翻成了中文，这里只负责把 `step` 映射成合适的状态码。
 */
export async function POST(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { source, note, siteModel, createSite: shouldCreateSite = true, siteName, suffix, withProductImages } = parsed.data;

  // ---- ⓪ 记一个"进行中的活儿"（断点恢复用） ----
  //
  // 实测动因（2026-09-11）：客户传了 10 张图、传到第 7 张时刷新，
  // **前 6 张的去向他一无所知**；或者生成到一半网络断了，回来只看到"失败"。
  // 记下来之后，回到页面能说"上次做到「拼装版面」，要接着做吗"。
  const job = await startJob("template-from-screenshot", { source, note, suffix });

  // ---- ① 图 → 可登记的产物 ----
  await advanceJob(job.jobId, "reading");
  const generated = await createTemplateFromScreenshot({
    source,
    note,
    siteModel,
    withProductImages: withProductImages ?? source.kind === "url",
    suffix,
  });
  if (!generated.ok) {
    // 尺寸/格式问题（read）是用户能自己修的 → 422；抓取失败（capture）是外部原因 → 502
    const status = generated.step === "read" || generated.step === "vision" || generated.step === "compose" ? 422 : 502;
    await failJob(job.jobId, { message: generated.message, detail: generated.detail });
    return Response.json(
      { error: `screenshot_${generated.step}_failed`, message: generated.message, detail: generated.detail, jobId: job.jobId },
      { status },
    );
  }
  const { bundle, understanding } = generated;
  await advanceJob(job.jobId, "registering");

  // ---- ② 登记模板（转调现有入口，不重写落盘逻辑） ----
  const registerUrl = new URL("/api/templates/runtime", request.url);
  const registerResponse = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 把调用方的身份原样带过去——`/api/templates/runtime` 自己会再鉴权一次，
      // 这里不替它做决定，也不提权。
      // ⚠️ 三头必须**都给**：strict 态下缺任一即 401（`lib/request-context.ts:97`）。
      // 此前漏了 workspace-id，与 `from-url` 同因——登记在**生产默认的 strict 态**
      // 下必然 401，而 relaxed（开发/e2e）不检查这两个头，所以 e2e 一直绿。
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
      assets: bundle.assets,
      binaryAssets: bundle.binaryAssets,
      tags: ["截图生成"],
      colors: { primary: bundle.tokens.primary, secondary: bundle.tokens.secondary, accent: bundle.tokens.accent },
    }),
  });
  const registerPayload = (await registerResponse.json().catch(() => null)) as
    | { error?: string; message?: string; blockers?: string[]; slots?: string[] }
    | null;

  if (registerResponse.status === 409) {
    // 撞 id 是**可恢复**的：换个后缀再来一次就好，前端可以自动重试
    await failJob(job.jobId, { message: `${bundle.templateId} 这个名字已经有了，换一个再试。` });
    return Response.json(
      { error: "template_id_taken", message: `${bundle.templateId} 这个名字已经有了，换一个再试。`, retryable: true, jobId: job.jobId },
      { status: 409 },
    );
  }
  if (!registerResponse.ok) {
    const message = registerPayload?.message ?? "模板没能登记进模板库。";
    await failJob(job.jobId, { message });
    return Response.json(
      {
        error: "template_register_failed",
        message,
        blockers: registerPayload?.blockers ?? [],
        templateId: bundle.templateId,
        jobId: job.jobId,
      },
      { status: 422 },
    );
  }

  // ---- ③ 建站（可选） ----
  /**
   * 可编辑位置的数量。
   *
   * 两个接口（本路由与 `from-url`）**必须返回同一个字段**——
   * 前端弹窗用同一个组件渲染结果，少一个字段就会显示 "undefined"。
   * 而它恰恰是用户最该看到的信息：B 的产物有十几个，A 的搬站常常只有 1 个。
   */
  const editable = (registerPayload?.slots ?? []).length;

  if (!shouldCreateSite) {
    return Response.json(
      {
        ok: true,
        templateId: bundle.templateId,
        siteId: null,
        slots: registerPayload?.slots ?? [],
        editable,
        summary: bundle.summary,
        warnings: bundle.warnings,
        understanding: { companyName: understanding.content.companyName, industry: understanding.content.industry, blocks: understanding.blocks.map((block) => block.type) },
        stats: bundle.stats,
      },
      { status: 201 },
    );
  }

  // 建站前把运行时模板的 manifest 注册上——否则工作台拿不到新模板的槽位契约
  // （与 `POST /api/sites` 开头那一步同理，这里也要做，因为下面直接调 store 而非路由）。
  ensureRuntimeTemplateManifests();

  // 草稿必须先过 schema：`createSite` 不做校验，脏草稿会在**读取时**才炸
  // （`normalizeDraft` 会静默回退成默认站点——用户看到的是"我的内容全没了"）。
  const draft = siteDraftSchema.safeParse(bundle.initialDraft);
  if (!draft.success) {
    await failJob(job.jobId, { message: "内容没能通过站点的数据校验。模板已可用，可以手动建站。" });
    return Response.json(
      {
        error: "draft_invalid",
        message: "模板登记成功了，但内容没能通过站点的数据校验。模板已可用，可以手动建站。",
        templateId: bundle.templateId,
        details: draft.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
      { status: 422 },
    );
  }

  await advanceJob(job.jobId, "creating-site");
  try {
    const finalName = siteName ?? `${understanding.content.siteName}（截图生成）`;
    const created = await createSite({
      name: finalName,
      templateId: bundle.templateId,
      locales: ["zh"],
      initialDraft: draft.data,
    });
    await finishJob(job.jobId, { templateId: bundle.templateId, siteId: created.id, summary: bundle.summary });
    return Response.json(
      {
        ok: true,
        templateId: bundle.templateId,
        siteId: created.id,
        siteName: finalName,
        slots: registerPayload?.slots ?? [],
        editable,
        summary: bundle.summary,
        warnings: bundle.warnings,
        understanding: { companyName: understanding.content.companyName, industry: understanding.content.industry, blocks: understanding.blocks.map((block) => block.type) },
        stats: bundle.stats,
      },
      { status: 201 },
    );
  } catch (error) {
    // 模板已经登记成功了——这一步失败不该让用户以为"整体失败"。
    // 如实分开报：模板可用，站没建成，以及为什么。
    await failJob(job.jobId, { message: `模板已经做好了，但建站时出错了：${error instanceof Error ? error.message : "未知错误"}` });
    return Response.json(
      {
        error: "site_create_failed",
        message: `模板已经做好了，但建站时出错了：${error instanceof Error ? error.message : "未知错误"}`,
        templateId: bundle.templateId,
        jobId: job.jobId,
      },
      { status: 422 },
    );
  }
}
