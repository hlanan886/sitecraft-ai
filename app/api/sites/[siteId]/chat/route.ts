import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { requestStructuredOperations } from "@/lib/ai-provider";
import { executeChatTaskPlan } from "@/lib/chat-task-executor";
import { planChatTasks } from "@/lib/chat-task-planner";
import { createGenerationDeadlines } from "@/lib/generation-budget";
import { describeDestructive, isDestructiveOperation, OperationPreconditionError } from "@/lib/site-operations";
import {
  commitOperations,
  getSite,
  isConversationalUndoMessage,
  snapshot,
  undoLatestAiChange,
} from "@/lib/site-store";
import {
  getOrCreateSession,
  isUnresolvableReferential,
  markRevisionDrift,
  pushAssistantMessage,
  pushUserMessage,
  recordAppliedChange,
  serializeSessionContext,
  sweepExpiredSessions,
  type ChatSession,
} from "@/lib/ai-session";
import { getTemplate } from "@/lib/site-model";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";
import { createGenerationProvenance } from "@/lib/generation-record";
import { hashRequestPayload, requestIdempotency } from "@/lib/request-idempotency";
import { buildSseReplayResponse, SSE_HEADERS } from "@/lib/sse-response";
import {
  checkSelectedTargetConformance,
  buildTemplateCapabilitySummary,
  nonVisualTemplateNotice,
  preflightTemplateSlots,
  validateOperationScope,
  selectedTargetMismatchMessage,
  unsupportedTemplateSlotMessage,
} from "@/lib/template-slot-guard";

export const runtime = "nodejs";

const chatSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(4000),
  selectedTarget: z.string().max(240).nullable().optional(),
  /** 最近对话上下文（多轮记忆）：[{role, text}]，最多 6 条，每条截断（过渡期保留，session 优先） */
  context: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(500),
  })).max(6).optional(),
  /** 破坏性操作确认标记：为 true 表示用户已确认要执行删除/隐藏/换模板/重排 */
  confirmedDestructive: z.boolean().optional(),
  /** 服务端会话 id（前端 sessionStorage 生成，每标签页独立） */
  sessionId: z.string().max(80).optional(),
  /** 当前预览 iframe 针对该 revision 实际识别到的可显示槽位 */
  templateCapabilities: z.object({
    templateId: z.string().max(80),
    revision: z.number().int().nonnegative(),
    slots: z.array(z.string().min(1).max(180)).max(3000),
  }).optional(),
  /**
   * 页面真实渲染结构摘要（P3.3，父页从 applied 报告序列化）。
   * 单独字段而非塞进 capabilities：两者长度上限差一个数量级（摘要限 6000 字符），
   * 且用途不同——capabilities 做槽位预检，本字段只进提示词。属不可信数据。
   */
  renderedStructure: z.string().max(6000).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

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
}

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "chat");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = chatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid chat payload", details: parsed.error.flatten() }, { status: 400 });
  const { siteId } = await params;
  // 沉淀出的模板需要在对话路径可见：`getTemplate()` 会读运行时注册表，
  // 未装载时 `preflightTemplateSlots` / `getTemplate().name` 会退回 forge，
  // 表现为「在一个沉淀模板的站点里，AI 报的模板名和槽位契约都是错的」。
  ensureRuntimeTemplateManifests();
  const idempotencyScope = `chat:${siteId}`;
  const idempotencyKey = parsed.data.idempotencyKey;
  if (idempotencyKey) {
    const decision = requestIdempotency.begin(idempotencyScope, idempotencyKey, hashRequestPayload(parsed.data));
    if (decision.status === "completed") return buildSseReplayResponse(decision.result);
    if (decision.status === "key_conflict") return Response.json({ error: "idempotency_key_reused", message: "同一请求标识不能用于不同内容，请重新提交。" }, { status: 409 });
    if (decision.status === "inflight") {
      return Response.json({ error: "request_inflight", message: "相同请求正在处理中，请等待当前结果。" }, { status: 409 });
    }
  }
  let current;
  try {
    current = await getSite(siteId);
  } catch (error) {
    if (idempotencyKey) requestIdempotency.release(idempotencyScope, idempotencyKey);
    throw error;
  }
  if (current.draft.revision !== parsed.data.baseRevision) {
    if (idempotencyKey) requestIdempotency.release(idempotencyScope, idempotencyKey);
    return Response.json({ error: "revision_conflict", message: "草稿已经更新，请刷新后重试。", ...current }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      eventMeta.set(controller, {
        requestId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        sequence: 0,
        revision: parsed.data.baseRevision,
        ...(idempotencyKey ? { idempotencyScope, idempotencyKey } : {}),
      });
      // 会话接入（③）：有 sessionId 才走服务端会话记忆，否则退回旧 context 路径（向后兼容）
      let session: ChatSession | null = null;
      let sessionContext: string | undefined;
      if (parsed.data.sessionId) {
        sweepExpiredSessions();
        session = getOrCreateSession(siteId, parsed.data.sessionId, {
          baseRevision: current.draft.revision,
          templateId: current.draft.templateId,
        });
        pushUserMessage(session, parsed.data.message);
        sessionContext = serializeSessionContext(session);
      }

      if (isConversationalUndoMessage(parsed.data.message)) {
        event(controller, { type: "status", value: "正在定位最近一次 AI 修改…" });
        try {
          const undone = await undoLatestAiChange({
            siteId,
            baseRevision: parsed.data.baseRevision,
            signal: request.signal,
          });
          if (undone.status === "applied") {
            const summary = `已撤销 AI 修改“${undone.undoneChange.summary}”`;
            if (session) {
              recordAppliedChange(session, {
                revision: undone.changeSet.revision,
                summary,
                targets: undone.changeSet.appliedTargets,
                draft: undone.record.draft,
              });
              pushAssistantMessage(session, summary);
            }
            event(controller, {
              type: "done",
              status: "applied",
              summary,
              changeSet: undone.changeSet,
              undoneChange: undone.undoneChange,
              ...snapshot(undone.record),
              attempts: 0,
            });
          } else if (undone.status === "unsafe") {
            const message = `无法安全撤销“${undone.targetChange.summary}”：该 AI 修改之后还有 ${undone.laterChanges.length} 项后续修改。为避免覆盖之后的人工或导入内容，本次未修改草稿。`;
            if (session) pushAssistantMessage(session, message);
            event(controller, {
              type: "done",
              status: "need_clarification",
              code: "unsafe_conversational_undo",
              message,
              targetChange: undone.targetChange,
              laterChanges: undone.laterChanges,
              ...snapshot(undone.record),
              attempts: 0,
            });
          } else if (undone.status === "empty" || undone.status === "no_change") {
            const message = undone.status === "empty"
              ? "当前草稿没有可撤销的 AI 修改。"
              : `“${undone.targetChange.summary}”已经没有可恢复的内容差异，草稿未修改。`;
            if (session) pushAssistantMessage(session, message);
            event(controller, { type: "done", status: "need_clarification", code: "no_ai_change_to_undo", message, ...snapshot(undone.record), attempts: 0 });
          } else {
            if (session) markRevisionDrift(session);
            event(controller, { type: "done", status: "conflict", error: "草稿在撤销期间已被更新，本次没有覆盖新版本。", ...snapshot(undone.record), attempts: 0 });
          }
        } catch (error) {
          event(controller, { type: "done", status: "error", code: "undo_error", error: error instanceof Error ? error.message : "撤销 AI 修改失败" });
        }
        controller.close();
        return;
      }

      // P2 保护：无历史可依的指代请求（"刚才改的标题"但本会话从没改过）→ 不调模型，直接澄清
      if (
        isUnresolvableReferential(parsed.data.message, session, {
          hasLegacyContext: Boolean(parsed.data.context?.length),
          hasSelectedTarget: Boolean(parsed.data.selectedTarget),
        })
      ) {
        event(controller, {
          type: "done",
          status: "need_clarification",
          message: "当前会话中没有可定位的上一项修改，请说明要修改哪个标题或字段。",
          attempts: 0,
        });
        controller.close();
        return;
      }

      const { workDeadlineAt } = createGenerationDeadlines(Date.now());
      const tasks = planChatTasks(parsed.data.message, parsed.data.selectedTarget);
      event(controller, { type: "status", value: `已拆分为 ${tasks.length} 项修改，正在并行处理…`, totalTasks: tasks.length });
      const provider = await executeChatTaskPlan({
        tasks,
        deadlineAt: workDeadlineAt,
        signal: request.signal,
        maxConcurrency: 2,
        runTask: async (task) => {
          event(controller, {
            type: "status",
            value: `正在处理：${task.instruction.slice(0, 60)}`,
            taskId: task.id,
            taskStatus: "generating",
            scopes: task.scopes,
          });
          const result = await requestStructuredOperations({
            message: task.instruction,
            draft: current.draft,
            templateId: current.draft.templateId,
            selectedTarget: task.selectedTarget,
            context: parsed.data.context,
            sessionContext,
            scope: { sections: task.scopes, productSkus: task.productSkus },
            renderedStructure: parsed.data.renderedStructure,
            // 对话改内容也要能看到用户粘贴的素材，否则「按素材改写」这类指令
            // 只能靠 model 猜（站点素材与站点绑定存储，见 direction-2 方案）。
            sourceMaterial: current.sourceMaterial,
            maxAttempts: 1,
            maxTokens: 2_200,
            deadlineAt: workDeadlineAt,
            signal: request.signal,
          });
          event(controller, {
            type: "status",
            value: result.ok ? "子任务已完成" : result.code === "output_truncated" ? "输出较长，正在拆分处理…" : "子任务失败",
            taskId: task.id,
            taskStatus: result.ok ? "completed" : result.code === "output_truncated" ? "splitting" : "failed",
            scopes: task.scopes,
          });
          return result;
        },
      });
      if (!provider.ok) {
        if (provider.code === "selected_target_mismatch" && parsed.data.selectedTarget) {
          const message = selectedTargetMismatchMessage(parsed.data.selectedTarget);
          if (session) pushAssistantMessage(session, message);
          event(controller, {
            type: "done",
            status: "need_clarification",
            code: provider.code,
            message,
            model: provider.model,
            latencyMs: provider.latencyMs,
            attempts: provider.attemptCount,
          });
          controller.close();
          return;
        }
        event(controller, { type: "done", status: "error", error: provider.error, code: provider.code, latencyMs: provider.latencyMs, attempts: provider.attemptCount });
        controller.close();
        return;
      }
      const finalProvider = provider;
      const scopeViolation = parsed.data.selectedTarget
        ? finalProvider.operations.find((operation) => !validateOperationScope(operation, {
            message: parsed.data.message,
            selectedTarget: parsed.data.selectedTarget,
            draft: current.draft,
          }).allowed)
        : undefined;
      const selectedTargetConformance = checkSelectedTargetConformance({
        message: parsed.data.message,
        selectedTarget: parsed.data.selectedTarget,
        operations: finalProvider.operations,
        draft: current.draft,
      });
      if ((!selectedTargetConformance.matches || scopeViolation) && parsed.data.selectedTarget) {
        const message = selectedTargetMismatchMessage(parsed.data.selectedTarget);
        if (session) pushAssistantMessage(session, message);
        event(controller, {
          type: "done",
          status: "need_clarification",
          code: "selected_target_mismatch",
          message,
          summary: finalProvider.summary,
          model: finalProvider.model,
          latencyMs: finalProvider.latencyMs,
          attempts: finalProvider.attemptCount,
        });
        controller.close();
        return;
      }
      // 所有批次聚合成功后只经过这一道破坏性确认门。
      const finalDestructive = finalProvider.operations.filter(isDestructiveOperation);
      if (finalDestructive.length && !parsed.data.confirmedDestructive) {
        event(controller, {
          type: "done",
          status: "need_confirmation",
          summary: finalProvider.summary,
          destructive: finalDestructive.map(describeDestructive),
          model: finalProvider.model,
          latencyMs: finalProvider.latencyMs,
          attempts: finalProvider.attemptCount,
        });
        controller.close();
        return;
      }
      const suppliedCapabilities = parsed.data.templateCapabilities;
      const availableSlots = suppliedCapabilities
        && suppliedCapabilities.templateId === current.draft.templateId
        && suppliedCapabilities.revision === current.draft.revision
        ? suppliedCapabilities.slots
        : undefined;
      const slotPreflight = preflightTemplateSlots({
        draft: current.draft,
        operations: finalProvider.operations,
        availableSlots,
      });
      if (slotPreflight.unsupportedTargets.length) {
        const message = unsupportedTemplateSlotMessage(
          getTemplate(current.draft.templateId).name,
          slotPreflight.unsupportedTargets,
        );
        if (session) pushAssistantMessage(session, message);
        event(controller, {
          type: "done",
          status: "need_clarification",
          code: "unsupported_template_slot",
          message,
          summary: finalProvider.summary,
          unsupportedTargets: slotPreflight.unsupportedTargets,
          model: finalProvider.model,
          latencyMs: finalProvider.latencyMs,
          attempts: finalProvider.attemptCount,
        });
        controller.close();
        return;
      }
      event(controller, { type: "status", value: "正在校验操作并保存草稿…" });
      try {
        const committed = await commitOperations({
          siteId,
          baseRevision: parsed.data.baseRevision,
          operations: finalProvider.operations,
          summary: finalProvider.summary,
          source: "ai",
          model: finalProvider.model,
          latencyMs: finalProvider.latencyMs,
          provenance: {
            ...createGenerationProvenance({
              provider: "DeepSeek",
              model: finalProvider.model,
              promptKey: "chat_operations",
              manifestVersion: buildTemplateCapabilitySummary(current.draft.templateId, current.draft.locale).manifestVersion,
              templateId: current.draft.templateId,
              buildRevision: parsed.data.baseRevision,
              inputText: parsed.data.message,
            }),
            baseRevision: parsed.data.baseRevision,
            selectedTarget: parsed.data.selectedTarget ?? null,
          },
        });
        if (committed.status === "conflict") {
          if (session) markRevisionDrift(session);
          event(controller, { type: "done", status: "conflict", error: "草稿在 AI 处理期间已被更新，本次操作没有覆盖新版本。", ...snapshot(committed.record), attempts: finalProvider.attemptCount });
        } else if (committed.status === "no_change") {
          if (session) pushAssistantMessage(session, finalProvider.summary);
          event(controller, { type: "done", status: "no_change", summary: finalProvider.summary, rejected: finalProvider.rejected, ...snapshot(committed.record), model: finalProvider.model, latencyMs: finalProvider.latencyMs, attempts: finalProvider.attemptCount });
        } else {
          if (session) {
            recordAppliedChange(session, {
              revision: committed.changeSet.revision,
              summary: finalProvider.summary,
              targets: committed.changeSet.appliedTargets,
              draft: committed.record.draft,
            });
            pushAssistantMessage(session, finalProvider.summary);
          }
          event(controller, {
            type: "done",
            status: "applied",
            summary: finalProvider.summary,
            rejected: finalProvider.rejected,
            changeSet: committed.changeSet,
            ...snapshot(committed.record),
            model: finalProvider.model,
            latencyMs: finalProvider.latencyMs,
            attempts: finalProvider.attemptCount,
            nonVisualTargets: slotPreflight.nonVisualTargets,
            ...(slotPreflight.nonVisualTargets.length ? { displayNotice: nonVisualTemplateNotice } : {}),
          });
        }
      } catch (error) {
        if (error instanceof OperationPreconditionError) {
          event(controller, {
            type: "done",
            status: "conflict",
            code: error.code,
            error: error.message,
            ...current,
            attempts: finalProvider.attemptCount,
          });
        } else {
          event(controller, { type: "done", status: "error", code: "operation_error", error: error instanceof Error ? error.message : "操作应用失败" });
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
