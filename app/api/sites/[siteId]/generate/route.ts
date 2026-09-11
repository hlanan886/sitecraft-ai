import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { after } from "next/server";
import { getSite, commitOperations, snapshot, type SiteRecord } from "@/lib/site-store";
import { requestSiteIntent, requestDraftOperations } from "@/lib/ai-provider";
import { mergeIntentDelta, normalizeUserBrief, previousIntentSchema, rankTemplateMatches, resolveTemplate, siteIntentSchema, toReadyIntent } from "@/lib/site-intent";
import { generateDraftOperations, regenerateMissingSectionsOperations, regenerateSectionOperations } from "@/lib/site-generator";
import { getTemplate } from "@/lib/site-model";
import { createGenerationDeadlines, GENERATION_BUDGET } from "@/lib/generation-budget";
import { createGenerationProvenance } from "@/lib/generation-record";
import { buildTemplateCapabilitySummary } from "@/lib/template-slot-guard";
import {
  getOrCreateSession,
  pushAssistantMessage,
  recordAppliedChange,
} from "@/lib/ai-session";
import { recordGeneration, type GenerationRecordInput } from "@/lib/generation-record";
import { classifyDraftCoverage, type ContentCoverageReport } from "@/lib/template-content-coverage";
import { getTemplateManifest } from "@/lib/template-manifest";
import { evaluateDraftQuality, type ContentQualityReport } from "@/lib/content-quality";
import { hashRequestPayload, requestIdempotency } from "@/lib/request-idempotency";
import { buildSseReplayResponse, SSE_HEADERS } from "@/lib/sse-response";

export const runtime = "nodejs";

// 纯符号/表情/emoji 输入：trim 拦不住（"😀".trim() 非空），必须正向判定"不含任何文字/数字"后拦截
// 用 [\p{L}\p{N}] 检测：!!!/---/组合 emoji/带肤色 emoji 全拦，全角文字/数字正确放行
const hasText = (v: string) => /[\p{L}\p{N}]/u.test(v);
const messageField = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine((v) => hasText(v), { message: "内容不能只有表情或符号" });

const generateSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("analyze"),
    message: messageField,
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().trim().min(1).max(400),
        }),
      )
      .max(10) // 多轮迭代：每轮 +2 条（user+assistant），10 条 ≈ 5 轮；超限前端 slice(-10)
      .optional(),
    // 多轮迭代基线：上一轮已确认意图，模型只改本轮影响的字段（增量更新）
    // 用宽松 schema：need_info 阶段前端回传的部分意图可能缺字段/空串，强校验会 400 阻断追问。
    previousIntent: previousIntentSchema.optional(),
    // P1 导入：用户粘贴的公司简介/产品清单（可选），以用户信息为准、缺失不编造
    extraContext: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  }),
  z.object({
    step: z.literal("execute"),
    message: messageField,
    intent: siteIntentSchema,
    templateId: z.string().min(1).max(80),
    siteLanguage: z.enum(["zh", "en"]).optional(),
    hiddenSections: z.array(z.enum(["about", "features", "services", "products", "contact"])).default([]),
    baseRevision: z.number().int().nonnegative(),
    sessionId: z.string().max(80).optional(),
    // C 块局部重生成：存在时只重生成指定板块（与全量生成二选一）
    regenerate: z
      .object({
        section: z.enum(["hero", "about", "features", "services", "products", "contact"]),
        direction: z.string().trim().max(200).optional(),
        mode: z.enum(["text", "all"]).optional(),
      })
      .optional(),
    regenerateMissing: z
      .object({
        sections: z.array(z.enum(["about", "features", "services", "products", "contact"])).min(1).max(5),
      })
      .optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  }),
]);

const COVERAGE_SECTION_ORDER = ["hero", "about", "features", "services", "products", "contact"] as const;
const emptyCoverage = (): ContentCoverageReport => ({
  filledTargets: [],
  aiFilledTargets: [],
  pendingTargets: [],
  residualDemoSlots: [],
  unmappedRequiredTargets: [],
});

function coverageForRecord(record: SiteRecord, templateId: string) {
  const manifest = getTemplateManifest(templateId);
  const coverage = manifest
    ? classifyDraftCoverage({
        draft: record.draft,
        manifest,
        appliedTargets: record.history.flatMap((change) => change.appliedTargets),
      })
    : emptyCoverage();
  const missingTargets = [
    ...coverage.pendingTargets,
    ...coverage.residualDemoSlots,
    ...coverage.unmappedRequiredTargets,
  ];
  const missing = new Set(missingTargets.map((target) => target.split(".")[0]));
  return {
    coverage,
    missingSections: COVERAGE_SECTION_ORDER.filter((section) => missing.has(section)),
  };
}

function qualityForRecord(record: SiteRecord, templateId: string): ContentQualityReport | null {
  const manifest = getTemplateManifest(templateId);
  return manifest ? evaluateDraftQuality(record.draft, manifest) : null;
}

type EventMeta = {
  requestId: string;
  taskId: string;
  sequence: number;
  revision: number;
  idempotencyScope?: string;
  idempotencyKey?: string;
};
const eventMeta = new WeakMap<ReadableStreamDefaultController<Uint8Array>, EventMeta>();

function event(controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) {
  try {
    const meta = eventMeta.get(controller);
    const record = value && typeof value === "object" ? value as Record<string, unknown> : { value };
    if (!meta) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(record)}\n\n`));
      return;
    }
    const nestedDraft = record.draft && typeof record.draft === "object" ? record.draft as Record<string, unknown> : null;
    const changeSet = record.changeSet && typeof record.changeSet === "object" ? record.changeSet as Record<string, unknown> : null;
    const revision = typeof nestedDraft?.revision === "number"
      ? nestedDraft.revision
      : typeof changeSet?.revision === "number"
        ? changeSet.revision
        : meta.revision;
    meta.revision = revision;
    const childTaskId = typeof record.taskId === "string" ? record.taskId : undefined;
    const enriched = {
      ...record,
      requestId: meta.requestId,
      taskId: meta.taskId,
      sequence: ++meta.sequence,
      revision,
      payload: record,
      ...(childTaskId ? { childTaskId } : {}),
    };
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(enriched)}\n\n`));
    if (record.type === "done" && meta.idempotencyScope && meta.idempotencyKey) {
      requestIdempotency.complete(meta.idempotencyScope, meta.idempotencyKey, enriched);
    }
  } catch {
    // 客户端已取消响应时，生成器通过 signal 收尾，不再写流。
  }
}

const ANALYZE_DEADLINE_MS = GENERATION_BUDGET.serverDeadlineMs;

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "generate");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid generate payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { siteId } = await params;
  const idempotencyScope = `generate:${siteId}`;
  const idempotencyKey = parsed.data.idempotencyKey;
  if (idempotencyKey) {
    const decision = requestIdempotency.begin(idempotencyScope, idempotencyKey, hashRequestPayload(parsed.data));
    if (decision.status === "completed") return buildSseReplayResponse(decision.result);
    if (decision.status === "key_conflict") return Response.json({ error: "idempotency_key_reused", message: "同一请求标识不能用于不同内容，请重新提交。" }, { status: 409 });
    if (decision.status === "inflight") {
      return Response.json({ error: "request_inflight", message: "相同请求正在处理中，请等待当前结果。" }, { status: 409 });
    }
  }
  const startedAt = Date.now(); // 生成耗时统计（存证用）
  const responseCancelled = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const initialRevision = parsed.data.step === "execute" ? parsed.data.baseRevision : 0;
      eventMeta.set(controller, {
        requestId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        sequence: 0,
        revision: initialRevision,
        ...(idempotencyKey ? { idempotencyScope, idempotencyKey } : {}),
      });
      if (parsed.data.step === "analyze") {
        const analyzeDeadlineAt = startedAt + ANALYZE_DEADLINE_MS;
        const analyzeSignal = AbortSignal.any([
          request.signal,
          responseCancelled.signal,
          AbortSignal.timeout(Math.max(1, analyzeDeadlineAt - Date.now())),
        ]);
        // 意图理解：一句话 → 结构化需求 + 模板推荐（不落盘，避免空站）
        event(controller, { type: "status", value: "正在理解你的需求…" });
        const history = parsed.data.history ?? [];
        const normalizedBrief = normalizeUserBrief(parsed.data.message);
        const intentRes = await requestSiteIntent({
          text: parsed.data.message,
          brief: normalizedBrief,
          history,
          previousIntent: parsed.data.previousIntent,
          extraContext: parsed.data.extraContext,
          signal: analyzeSignal,
          deadlineAt: analyzeDeadlineAt,
        });
        if (!intentRes.ok) {
          event(controller, { type: "done", status: "error", error: intentRes.error, code: intentRes.code, latencyMs: intentRes.latencyMs });
          controller.close();
          return;
        }
        // 注意命名：done.status 是传输层状态（分析成功），业务决策看 resp.status
        const resp = intentRes.intent;
        if (resp.status !== "ready") {
          // need_info / rejected：把业务决策原样回传（含 siteLanguage，前端补充后建站能拿到语言），由前端展示追问或拒绝原因
          event(controller, { type: "done", status: "ready", intent: resp, siteLanguage: resp.siteLanguage ?? "zh", model: intentRes.model, latencyMs: intentRes.latencyMs });
          controller.close();
          return;
        }
        // 多轮迭代：把模型本轮输出合并到上一轮基线（缺失字段保留基线，防漂移）
        // previousIntent 与 siteLanguage 一起作为基线传入（siteLanguage 不在 SiteIntent 类型里）
        const merged = mergeIntentDelta(
          parsed.data.previousIntent ? { intent: parsed.data.previousIntent, siteLanguage: resp.siteLanguage } : null,
          resp,
        );
        const ready = toReadyIntent(merged); // superRefine 已保证成功，此为类型收窄 + 防御
        if (!ready) {
          event(controller, { type: "done", status: "error", error: "意图解析失败", code: "invalid_output" });
          controller.close();
          return;
        }
        const { intent, siteLanguage } = ready;
        event(controller, { type: "status", value: "正在匹配模板…" });
        // 关键词匹配覆盖多轮上下文：历史用户文本 + 当前文本拼接（"咖啡品牌"出现在第二轮也不丢）
        // 模板稳定性：无方向关键词（本轮只是微调）→ 保持上一轮模板，防来回跳
        const template = resolveTemplate(
          intent,
          [...history.map((h) => h.text), parsed.data.message].join(" "),
          undefined,
          parsed.data.previousIntent?.recommendedTemplateId,
        );
        const recommendations = rankTemplateMatches(
          normalizedBrief,
          [...history.map((h) => h.text), parsed.data.message].join(" "),
        );
        event(controller, {
          type: "done",
          status: "ready",
          intent: merged, // 传合并后意图（含基线回填），确认页展示完整
          siteLanguage,
          template: {
            id: template.templateId,
            name: template.name,
            category: template.category,
            reason: template.reason,
          },
          recommendations: recommendations.map((item) => ({
            id: item.templateId,
            name: item.name,
            category: item.category,
            score: item.score,
            reason: item.reason,
            reasons: item.reasons,
            penalties: item.penalties,
          })),
          hiddenSections: [],
          model: intentRes.model,
          latencyMs: intentRes.latencyMs,
        });
        controller.close();
        return;
      }

      // execute：为所选现有模板生成内容（单次 commit，可撤销）
      const executeData = parsed.data;
      const regenerate = executeData.regenerate;
      const regenerateMissing = executeData.regenerateMissing;
      if (regenerate && regenerateMissing) {
        event(controller, { type: "done", status: "error", code: "invalid_scope", error: "不能同时重生成单板块和补全多个板块" });
        controller.close();
        return;
      }
      const { serverDeadlineAt: deadlineAt, workDeadlineAt } = createGenerationDeadlines(startedAt);
      const generationSignal = AbortSignal.any([
        request.signal,
        responseCancelled.signal,
        AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
      ]);
      let terminalRecordScheduled = false;
      const recordTerminal = (terminal: {
        status: GenerationRecordInput["status"];
        outcome: GenerationRecordInput["outcome"];
        operations?: GenerationRecordInput["operations"];
        model?: string;
        missingSections?: string[];
        appliedTemplateId?: string;
        fallbackReason?: string;
        errorCode?: string;
      }) => {
        if (terminalRecordScheduled) return;
        terminalRecordScheduled = true;
        const appliedTemplateId = terminal.appliedTemplateId ?? executeData.templateId;
        const provenance = terminal.model
          ? createGenerationProvenance({
              provider: terminal.model === "local-fast-fallback" ? "local" : "DeepSeek",
              model: terminal.model,
              promptKey: "draft_operations",
              manifestVersion: buildTemplateCapabilitySummary(appliedTemplateId, "zh").manifestVersion,
              templateId: appliedTemplateId,
              buildRevision: "baseRevision" in parsed.data ? parsed.data.baseRevision : 0,
              inputText: executeData.message,
            })
          : undefined;
        after(() => recordGeneration({
          siteId,
          inputText: executeData.message,
          intent: executeData.intent,
          operations: terminal.operations ?? [],
          templateId: appliedTemplateId,
          latencyMs: Date.now() - startedAt,
          model: terminal.model ?? "",
          status: terminal.status,
          outcome: terminal.outcome,
          mode: regenerate || regenerateMissing ? "regenerate" : "full",
          missingSections: terminal.missingSections ?? [],
          requestedTemplateId: executeData.templateId,
          provenance,
          appliedTemplateId,
          fallbackReason: terminal.fallbackReason,
          errorCode: terminal.errorCode,
          detail: regenerate
            ? `regenerate:${regenerate.section}`
            : regenerateMissing
              ? `regenerate-missing:${regenerateMissing.sections.join(",")}`
              : undefined,
        }));
      };
      const current = await getSite(siteId);
      if (current.draft.revision !== parsed.data.baseRevision) {
        recordTerminal({ status: "conflict", outcome: "conflict", errorCode: "revision_conflict" });
        event(controller, { type: "done", status: "conflict", error: "草稿已经更新，请刷新后重试。" });
        controller.close();
        return;
      }
      const requestedHiddenSections = parsed.data.step === "execute" ? parsed.data.hiddenSections : [];
      const generationSections = regenerateMissing
        ? regenerateMissing.sections
        : ["hero", ...parsed.data.intent.coreSections.filter((section) => !requestedHiddenSections.includes(section))];
      event(controller, {
        type: "status",
        value: regenerateMissing
          ? `正在补全 ${regenerateMissing.sections.join("、")} 板块…`
          : parsed.data.regenerate
            ? `正在重生成 ${parsed.data.regenerate.section} 板块…`
            : "正在复用模板结构，并行填充首屏和板块内容…",
        phase: "content",
        completedSections: [],
        activeSections: generationSections,
        recoveringSections: [],
        failedSections: [],
      });
      const draftOpsProvider = async (args: Parameters<typeof requestDraftOperations>[0]) => {
        const r = await requestDraftOperations(args);
        return r.ok
          ? { ok: true as const, summary: r.summary, operations: r.operations, model: r.model }
          : { ok: false as const, code: r.code, error: r.error };
      };
      // C 块：局部重生成（只改目标板块，基于当前草稿）与全量生成二选一
      // 提前提取（回调外窄化）：regenerate 仅 execute 分支存在
      const generated = regenerate
        ? await regenerateSectionOperations({
            intent: parsed.data.intent,
            templateId: parsed.data.templateId,
            baseDraft: current.draft,
            section: regenerate.section,
            direction: regenerate.direction,
            mode: regenerate.mode,
            siteLanguage: parsed.data.siteLanguage,
            draftOps: draftOpsProvider,
            signal: generationSignal,
            deadlineAt: workDeadlineAt,
          })
        : regenerateMissing
          ? await regenerateMissingSectionsOperations({
              intent: parsed.data.intent,
              templateId: parsed.data.templateId,
              baseDraft: current.draft,
              sections: regenerateMissing.sections,
              siteLanguage: parsed.data.siteLanguage,
              draftOps: draftOpsProvider,
              signal: generationSignal,
              deadlineAt: workDeadlineAt,
            })
        : await generateDraftOperations({
            intent: parsed.data.intent,
            templateId: parsed.data.templateId,
            hiddenSections: parsed.data.hiddenSections,
            siteLanguage: parsed.data.siteLanguage,
            draftOps: draftOpsProvider,
            signal: generationSignal,
            deadlineAt: workDeadlineAt,
            onProgress: (progress) => event(controller, { type: "status", value: progress.message, ...progress }),
          });
      if (!generated.ok) {
        recordTerminal({ status: "error", outcome: "error", errorCode: generated.code });
        event(controller, { type: "done", status: "error", error: generated.error, code: generated.code });
        controller.close();
        return;
      }
      if (generationSignal.aborted) {
        recordTerminal({ status: "error", outcome: "error", errorCode: request.signal.aborted || responseCancelled.signal.aborted ? "client_aborted" : "timeout" });
        try { controller.close(); } catch { /* 响应已由客户端取消 */ }
        return;
      }
      event(controller, { type: "status", value: "正在校验内容并保存到模板草稿…", phase: "saving", completedSections: generated.completedSections, activeSections: [], recoveringSections: [], failedSections: generated.missingSections });
      try {
        const committed = await commitOperations({
          siteId,
          baseRevision: parsed.data.baseRevision,
          operations: generated.operations,
          summary: generated.summary,
          source: "ai",
          model: generated.model,
          latencyMs: 0,
          signal: generationSignal,
        });
        // 播种会话：让"刚才生成的首屏"在工作区能命中
        if (parsed.data.sessionId && committed.status === "applied") {
          const session = getOrCreateSession(siteId, parsed.data.sessionId, {
            baseRevision: committed.changeSet.revision,
            templateId: current.draft.templateId,
          });
          recordAppliedChange(session, {
            revision: committed.changeSet.revision,
            summary: generated.summary,
            targets: committed.changeSet.appliedTargets,
            draft: committed.record.draft,
          });
          pushAssistantMessage(session, generated.summary);
        }
        if (committed.status === "conflict") {
          recordTerminal({ status: "conflict", outcome: "conflict", operations: generated.operations, model: generated.model, errorCode: "commit_conflict" });
          event(controller, { type: "done", status: "conflict", error: "草稿在生成期间已被更新。", ...snapshot(committed.record) });
        } else if (committed.status === "no_change") {
          const contentState = coverageForRecord(committed.record, committed.record.draft.templateId);
          const quality = qualityForRecord(committed.record, committed.record.draft.templateId);
          const missingSections = [...new Set([...generated.missingSections, ...contentState.missingSections])];
          recordTerminal({ status: "no_change", outcome: "no_change", operations: generated.operations, model: generated.model });
          event(controller, {
            type: "done",
            status: "no_change",
            summary: generated.summary,
            ...snapshot(committed.record),
            model: generated.model,
            partial: missingSections.length > 0,
            missingSections,
            coverage: contentState.coverage,
            quality,
          });
        } else {
          const requestedTemplateId = "requestedTemplateId" in generated ? generated.requestedTemplateId : parsed.data.templateId;
          const appliedTemplateId = "appliedTemplateId" in generated ? generated.appliedTemplateId : parsed.data.templateId;
          const fallbackReason = "templateFallbackReason" in generated ? generated.templateFallbackReason : undefined;
          const contentState = coverageForRecord(committed.record, appliedTemplateId);
          const quality = qualityForRecord(committed.record, appliedTemplateId);
          const generatedMissingSections = new Set<string>(generated.missingSections);
          const coverageMissingSections = new Set<string>(contentState.missingSections);
          const missingSections = COVERAGE_SECTION_ORDER.filter((section) => (
            generatedMissingSections.has(section) || coverageMissingSections.has(section)
          ));
          const partial = missingSections.length > 0;
          recordTerminal({
            status: "applied",
            outcome: partial ? "partial" : "complete",
            operations: generated.operations,
            model: generated.model,
            missingSections,
            appliedTemplateId,
            fallbackReason,
          });
          // B2 自评结果下发（fail-open：issues 仅提示，不阻塞）
          event(controller, {
            type: "done",
            status: "applied",
            summary: generated.summary,
            changeSet: committed.changeSet,
            ...snapshot(committed.record),
            model: generated.model,
            selfEvalIssues: generated.selfEvalIssues,
            // P0-2：批 B（板块内容）失败时透传 partial，前端提示"板块未完整生成"
            partial,
            missingSections,
            coverage: contentState.coverage,
            quality,
            requestedTemplateId,
            appliedTemplateId,
            templateFallbackReason: fallbackReason,
            // C 块局部重生成：返回目标板块 + 未动的板块（借鉴 replace_section_in_page 的 preserved_sections）
            ...(regenerate
              ? {
                  regenerated: regenerate.section,
                  preserved: ["about", "features", "services", "products", "contact"].filter((s) => s !== regenerate.section),
                }
              : regenerateMissing
                ? {
                    regenerated: generated.completedSections,
                    preserved: ["hero", "about", "features", "services", "products", "contact"].filter((section) => !regenerateMissing.sections.includes(section as typeof regenerateMissing.sections[number])),
                  }
              : {}),
          });
        }
      } catch (error) {
        const aborted = generationSignal.aborted || (error instanceof Error && error.name === "AbortError");
        const errorCode = aborted ? (request.signal.aborted || responseCancelled.signal.aborted ? "client_aborted" : "timeout") : "operation_error";
        recordTerminal({ status: "error", outcome: "error", errorCode });
        event(controller, { type: "done", status: "error", code: errorCode, error: aborted ? "生成已在保存前取消" : error instanceof Error ? error.message : "生成失败" });
      }
      controller.close();
    },
    cancel(reason) {
      responseCancelled.abort(reason);
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
