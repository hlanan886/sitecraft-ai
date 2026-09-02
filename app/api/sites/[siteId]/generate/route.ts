import { z } from "zod";
import { after } from "next/server";
import { getSite, commitOperations, snapshot } from "@/lib/site-store";
import { requestSiteIntent, requestDraftOperations } from "@/lib/ai-provider";
import { mergeIntentDelta, resolveTemplate, siteIntentSchema, toReadyIntent } from "@/lib/site-intent";
import { generateDraftOperations, regenerateSectionOperations } from "@/lib/site-generator";
import { getTemplate } from "@/lib/site-model";
import {
  getOrCreateSession,
  pushAssistantMessage,
  recordAppliedChange,
} from "@/lib/ai-session";
import { recordGeneration, type GenerationRecordInput } from "@/lib/generation-record";

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
    previousIntent: siteIntentSchema.optional(),
    // P1 导入：用户粘贴的公司简介/产品清单（可选），以用户信息为准、缺失不编造
    extraContext: z.string().trim().max(2000).optional(),
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
  }),
]);

function event(controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
}

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid generate payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { siteId } = await params;
  const startedAt = Date.now(); // 生成耗时统计（存证用）

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (parsed.data.step === "analyze") {
        // 意图理解：一句话 → 结构化需求 + 模板推荐（不落盘，避免空站）
        event(controller, { type: "status", value: "正在理解你的需求…" });
        const history = parsed.data.history ?? [];
        const intentRes = await requestSiteIntent({
          text: parsed.data.message,
          history,
          previousIntent: parsed.data.previousIntent,
          extraContext: parsed.data.extraContext,
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
          mode: regenerate ? "regenerate" : "full",
          missingSections: terminal.missingSections ?? [],
          requestedTemplateId: executeData.templateId,
          appliedTemplateId,
          fallbackReason: terminal.fallbackReason,
          errorCode: terminal.errorCode,
          detail: regenerate ? `regenerate:${regenerate.section}` : undefined,
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
      const generationSections = ["hero", ...parsed.data.intent.coreSections.filter((section) => !requestedHiddenSections.includes(section))];
      event(controller, {
        type: "status",
        value: parsed.data.regenerate ? `正在重生成 ${parsed.data.regenerate.section} 板块…` : "正在复用模板结构，并行填充首屏和板块内容…",
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
          })
        : await generateDraftOperations({
            intent: parsed.data.intent,
            templateId: parsed.data.templateId,
            hiddenSections: parsed.data.hiddenSections,
            siteLanguage: parsed.data.siteLanguage,
            draftOps: draftOpsProvider,
            onProgress: (progress) => event(controller, { type: "status", value: progress.message, ...progress }),
          });
      if (!generated.ok) {
        recordTerminal({ status: "error", outcome: "error", errorCode: generated.code });
        event(controller, { type: "done", status: "error", error: generated.error, code: generated.code });
        controller.close();
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
          recordTerminal({ status: "no_change", outcome: "no_change", operations: generated.operations, model: generated.model });
          event(controller, { type: "done", status: "no_change", summary: generated.summary, ...snapshot(committed.record), model: generated.model });
        } else {
          const requestedTemplateId = "requestedTemplateId" in generated ? generated.requestedTemplateId : parsed.data.templateId;
          const appliedTemplateId = "appliedTemplateId" in generated ? generated.appliedTemplateId : parsed.data.templateId;
          const fallbackReason = "templateFallbackReason" in generated ? generated.templateFallbackReason : undefined;
          recordTerminal({
            status: "applied",
            outcome: generated.partial ? "partial" : "complete",
            operations: generated.operations,
            model: generated.model,
            missingSections: generated.missingSections,
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
            partial: generated.partial,
            missingSections: generated.missingSections,
            requestedTemplateId,
            appliedTemplateId,
            templateFallbackReason: fallbackReason,
            // C 块局部重生成：返回目标板块 + 未动的板块（借鉴 replace_section_in_page 的 preserved_sections）
            ...(regenerate
              ? {
                  regenerated: regenerate.section,
                  preserved: ["about", "features", "services", "products", "contact"].filter((s) => s !== regenerate.section),
                }
              : {}),
          });
        }
      } catch (error) {
        recordTerminal({ status: "error", outcome: "error", errorCode: "operation_error" });
        event(controller, { type: "done", status: "error", code: "operation_error", error: error instanceof Error ? error.message : "生成失败" });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
