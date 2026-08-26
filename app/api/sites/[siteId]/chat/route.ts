import { z } from "zod";
import { requestStructuredOperations } from "@/lib/ai-provider";
import { describeDestructive, isDestructiveOperation } from "@/lib/site-operations";
import { commitOperations, getSite, snapshot } from "@/lib/site-store";
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
import {
  evaluateOperations,
  selectRetryIssues,
  shouldSelfEvaluate,
} from "@/lib/ai-self-eval";

export const runtime = "nodejs";

const chatSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(4000),
  selectedTarget: z.string().max(120).nullable().optional(),
  /** 最近对话上下文（多轮记忆）：[{role, text}]，最多 6 条，每条截断（过渡期保留，session 优先） */
  context: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(500),
  })).max(6).optional(),
  /** 破坏性操作确认标记：为 true 表示用户已确认要执行删除/隐藏/换模板/重排 */
  confirmedDestructive: z.boolean().optional(),
  /** 服务端会话 id（前端 sessionStorage 生成，每标签页独立） */
  sessionId: z.string().max(80).optional(),
});

function event(controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
}

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const parsed = chatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid chat payload", details: parsed.error.flatten() }, { status: 400 });
  const { siteId } = await params;
  const current = await getSite(siteId);
  if (current.draft.revision !== parsed.data.baseRevision) {
    return Response.json({ error: "revision_conflict", message: "草稿已经更新，请刷新后重试。", ...current }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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

      event(controller, { type: "status", value: "正在调用模型并生成结构化操作…" });
      const provider = await requestStructuredOperations({
        message: parsed.data.message,
        draft: current.draft,
        templateId: current.draft.templateId,
        selectedTarget: parsed.data.selectedTarget,
        context: parsed.data.context,
        sessionContext,
      });
      if (!provider.ok) {
        event(controller, { type: "done", status: "error", error: provider.error, code: provider.code, latencyMs: provider.latencyMs, attempts: provider.attemptCount });
        controller.close();
        return;
      }
      // 破坏性操作确认：含删除/隐藏/换模板/重排且用户未确认 → 暂停，等确认
      const destructiveOps = provider.operations.filter(isDestructiveOperation);
      if (destructiveOps.length && !parsed.data.confirmedDestructive) {
        event(controller, {
          type: "done",
          status: "need_confirmation",
          summary: provider.summary,
          destructive: destructiveOps.map(describeDestructive),
          model: provider.model,
          latencyMs: provider.latencyMs,
          attempts: provider.attemptCount,
        });
        controller.close();
        return;
      }
      // 模型自评（① 做轻）：仅大改动时触发；不通过 → 带 feedback 重生成 1 次
      let finalProvider = provider;
      let selfEvaluated = false;
      let evalIssues: string[] = [];
      if (shouldSelfEvaluate(provider.operations, parsed.data.message)) {
        selfEvaluated = true;
        event(controller, { type: "status", value: "正在质检本次修改…" });
        const evalRes = await evaluateOperations({
          message: parsed.data.message,
          summary: provider.summary,
          operations: provider.operations,
          selectedTarget: parsed.data.selectedTarget,
          contextBlock: sessionContext,
          templateId: current.draft.templateId,
        });
        if (!evalRes.ok) {
          const feedback = selectRetryIssues(evalRes.issues);
          evalIssues = evalRes.issues.filter((i) => i.severity === "error").map((i) => `[${i.code}] ${i.message}`);
          if (feedback) {
            const retry = await requestStructuredOperations({
              message: parsed.data.message,
              draft: current.draft,
              templateId: current.draft.templateId,
              selectedTarget: parsed.data.selectedTarget,
              context: parsed.data.context,
              sessionContext,
              feedback,
            });
            if (retry.ok) {
              finalProvider = retry;
            } else {
              // H3：重生成失败时记录日志（fail-open 用原 provider），便于排查
              console.error(`[ai-self-eval] 重生成失败，使用原操作提交: ${retry.error}`);
            }
          }
        }
      }
      // 重生成可能改变破坏性操作 → 重跑确认门（已确认则跳过）
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
        });
        if (committed.status === "conflict") {
          if (session) markRevisionDrift(session);
          event(controller, { type: "done", status: "conflict", error: "草稿在 AI 处理期间已被更新，本次操作没有覆盖新版本。", ...snapshot(committed.record), attempts: finalProvider.attemptCount });
        } else if (committed.status === "no_change") {
          if (session) pushAssistantMessage(session, finalProvider.summary);
          event(controller, { type: "done", status: "no_change", summary: finalProvider.summary, rejected: finalProvider.rejected, ...snapshot(committed.record), model: finalProvider.model, latencyMs: finalProvider.latencyMs, selfEvaluated, evalIssues, attempts: finalProvider.attemptCount });
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
          event(controller, { type: "done", status: "applied", summary: finalProvider.summary, rejected: finalProvider.rejected, changeSet: committed.changeSet, ...snapshot(committed.record), model: finalProvider.model, latencyMs: finalProvider.latencyMs, selfEvaluated, evalIssues, attempts: finalProvider.attemptCount });
        }
      } catch (error) {
        event(controller, { type: "done", status: "error", code: "operation_error", error: error instanceof Error ? error.message : "操作应用失败" });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
