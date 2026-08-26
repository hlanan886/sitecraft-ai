import { z } from "zod";
import { requestStructuredOperations } from "@/lib/ai-provider";
import { commitOperations, getSite, snapshot } from "@/lib/site-store";

export const runtime = "nodejs";

const chatSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(4000),
  selectedTarget: z.string().max(120).nullable().optional(),
  /** 最近对话上下文（多轮记忆）：[{role, text}]，最多 6 条，每条截断 */
  context: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(500),
  })).max(6).optional(),
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
      event(controller, { type: "status", value: "正在调用模型并生成结构化操作…" });
      const provider = await requestStructuredOperations({
        message: parsed.data.message,
        draft: current.draft,
        templateId: current.draft.templateId,
        selectedTarget: parsed.data.selectedTarget,
        context: parsed.data.context,
      });
      if (!provider.ok) {
        event(controller, { type: "done", status: "error", error: provider.error, code: provider.code, latencyMs: provider.latencyMs });
        controller.close();
        return;
      }
      event(controller, { type: "status", value: "正在校验操作并保存草稿…" });
      try {
        const committed = await commitOperations({
          siteId,
          baseRevision: parsed.data.baseRevision,
          operations: provider.operations,
          summary: provider.summary,
          source: "ai",
          model: provider.model,
          latencyMs: provider.latencyMs,
        });
        if (committed.status === "conflict") {
          event(controller, { type: "done", status: "conflict", error: "草稿在 AI 处理期间已被更新，本次操作没有覆盖新版本。", ...snapshot(committed.record) });
        } else if (committed.status === "no_change") {
          event(controller, { type: "done", status: "no_change", summary: provider.summary, rejected: provider.rejected, ...snapshot(committed.record), model: provider.model, latencyMs: provider.latencyMs });
        } else {
          event(controller, { type: "done", status: "applied", summary: provider.summary, rejected: provider.rejected, changeSet: committed.changeSet, ...snapshot(committed.record), model: provider.model, latencyMs: provider.latencyMs });
        }
      } catch (error) {
        event(controller, { type: "done", status: "error", code: "operation_error", error: error instanceof Error ? error.message : "操作应用失败" });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
