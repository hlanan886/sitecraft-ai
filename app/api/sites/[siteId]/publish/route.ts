import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { evaluateDraftQuality } from "@/lib/content-quality";
import { policyDecision } from "@/lib/content-policy";
import { collectAssetGateWarnings } from "@/lib/publish-gates";
import { requestIdempotency } from "@/lib/request-idempotency";
import { createRelease, getPublishedRelease } from "@/lib/release-store";
import { getSite } from "@/lib/site-store";
import { getTemplateManifest, getTemplatePresentation } from "@/lib/template-manifest";
import { evaluateFidelity } from "@/lib/template-fidelity-guard";
import { sectionKeys } from "@/lib/site-document";

export const runtime = "nodejs";

const publishSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  publishedBy: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  // 事实人工确认：用户核对生成内容中的数字/认证/性能声明后明确确认属实。
  // 确认后允许跳过 unverifiedFacts / 诚实占位 两类拦截；仍不豁免 missingSlots 等硬缺口。
  factsConfirmed: z.boolean().optional().default(false),
  /**
   * 渲染事实（2026-09-10 接入忠实度门禁）：由工作台从预览桥的 `sitecraft:applied`
   * 报告回传。**L2 残留区块 / L3 结构判定必须看"页面上真正渲染了什么"**——
   * 那只能由浏览器给出，服务端从 draft JSON 重算不出来。
   * 缺省时不跑这两层（向后兼容旧客户端 / 无头调用）。
   */
  renderFacts: z.object({
    visibleTexts: z.array(z.string().max(4000)).max(500),
    generatedSections: z.array(z.string().max(40)).max(40),
    appliedSections: z.array(z.string().max(120)).max(200),
  }).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { siteId } = await params;
  const release = await getPublishedRelease(siteId);
  return release
    ? Response.json({ status: "published", release }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "published_not_found", message: "当前站点还没有已发布版本。" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "publish");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid publish payload", details: parsed.error.flatten() }, { status: 400 });
  const { siteId } = await params;
  const scope = `publish:${siteId}`;
  const key = parsed.data.idempotencyKey;
  if (key) {
    const decision = requestIdempotency.begin(scope, key);
    if (decision.status === "completed") return Response.json(decision.result, { headers: { "X-Idempotent-Replay": "true" } });
    if (decision.status === "inflight") return Response.json({ error: "request_inflight", message: "相同发布请求正在处理中，请等待当前结果。" }, { status: 409 });
  }

  let current;
  try {
    current = await getSite(siteId);
  } catch (error) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: error instanceof Error ? error.message : "读取草稿失败" }, { status: 422 });
  }
  if (current.draft.revision !== parsed.data.baseRevision) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: "revision_conflict", message: "草稿已经更新，请刷新后再发布。", draft: current.draft, revision: current.draft.revision }, { status: 409 });
  }
  const manifest = getTemplateManifest(current.draft.templateId);
  if (!manifest) {
    if (key) requestIdempotency.release(scope, key);
    return Response.json({ error: "publish_blocked", message: "当前模板缺少内容契约，暂时不能发布。" }, { status: 422 });
  }
  const quality = evaluateDraftQuality(current.draft, manifest, {
    // 同上：用户素材是事实基准，否则「粘了真实资质反而发不出去」。
    factReference: current.sourceMaterial,
  });
  if (!quality.publishable) {
    // 放行决策**从策略树派生**（lib/content-policy.ts）：发布门不再自己列"哪些字段算阻断项"。
    // 唯一可由用户豁免的是 unverified_fact（显式确认属实后放行）。
    // 事实缺失（fact_gap）是 warn 级，本就不在此处拦截——发布时由预览桥隐藏该字段。
    const decision = policyDecision(quality.counts, parsed.data.factsConfirmed);
    if (!decision.allowed) {
      if (key) requestIdempotency.release(scope, key);
      return Response.json({
        error: "publish_blocked",
        message: decision.message || "发布前仍有内容需要人工确认或补全。",
        quality,
        revision: current.draft.revision,
      }, { status: 422 });
    }
  }

  // 模板层门禁（L2b 资产层）：首屏主视觉仍是模板 demo 素材 → 发布成功时随结果返回警告。
  // 不阻断（见 collectAssetGateWarnings 注释：12/22 模板命中，阻断会让新站一律发不出去）。
  const assetWarnings = collectAssetGateWarnings(current.draft);

  /**
   * 模板忠实度门禁（L2 残留区块 + L3 结构）——2026-09-10 接线。
   *
   * 此前 `evaluateFidelity`（`lib/template-fidelity-guard.ts`）写了 385 行三层检测，
   * 但**在生产代码中零 import**，只活在 scripts/ 与 tests/ 里 → 是装饰性代码。
   * 而 P4 新模板的验收依赖它（人眼看不出来模板自带的 lorem/人名，也看不出结构偏差）。
   *
   * 接入需要**渲染事实**（L2 判定页面文本、L3 判定哪些节走了通用兜底区）——
   * 这些只存在于浏览器侧，由工作台随请求带上（`renderFacts`）。
   *
   * **默认只警告不阻断**：L3 结构违规在 22 模板里的真实发生率未经实测，
   * 冒然阻断可能让所有站都发不出去（这正是 L2b 资产门禁当初留成警告的原因）。
   * 先跑出基线数据，再决定是否收紧为 422。
   */
  const fidelityWarnings: Array<{ description: string; severity: "high" | "medium" }> = [];
  if (parsed.data.renderFacts) {
    const presentation = getTemplatePresentation(current.draft.templateId);
    const report = evaluateFidelity({
      visibleText: parsed.data.renderFacts.visibleTexts,
      sections: sectionKeys.filter((section) => !(current.draft.hiddenSections ?? []).includes(section)),
      generatedSections: parsed.data.renderFacts.generatedSections,
      appliedSections: parsed.data.renderFacts.appliedSections,
      templateId: current.draft.templateId,
      presentation,
    });
    for (const finding of report.residualBlocks) {
      fidelityWarnings.push({ description: `模板残留内容未覆盖：${finding.description}（${finding.evidence.slice(0, 40)}）`, severity: "high" });
    }
    for (const check of report.structure) {
      if (check.violation) fidelityWarnings.push({ description: `${check.section} 板块未落在模板原生排版（走了通用兜底区）`, severity: "medium" });
    }
    for (const issue of report.assetIssues) {
      if (issue.severity === "high") fidelityWarnings.push({ description: issue.description, severity: "high" });
    }
  }

  try {
    const release = await createRelease({
      siteId,
      draft: current.draft,
      expectedRevision: parsed.data.baseRevision,
      publishedBy: parsed.data.publishedBy,
    });
    const result = {
      status: "published",
      release,
      ...(assetWarnings.length > 0 ? { assetWarnings } : {}),
      ...(fidelityWarnings.length > 0 ? { fidelityWarnings } : {}),
    };
    if (key) requestIdempotency.complete(scope, key, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (key) requestIdempotency.release(scope, key);
    const conflict = error && typeof error === "object" && "code" in error && error.code === "revision_conflict";
    return Response.json({ error: conflict ? "revision_conflict" : "publish_failed", message: error instanceof Error ? error.message : "发布失败" }, { status: conflict ? 409 : 422 });
  }
}
