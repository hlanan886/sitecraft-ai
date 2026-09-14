import { z } from "zod";
import { siteDraftSchema } from "@/lib/site-document";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { siteOperationSchema, checkCopyLength, validateOperationShapes } from "@/lib/site-operations";
import { commitOperations, getSite, setSiteSourceMaterial, snapshot } from "@/lib/site-store";

export const runtime = "nodejs";

const updateSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(siteOperationSchema).min(1).max(25),
  summary: z.string().min(1).max(500),
  source: z.enum(["import", "manual", "migration", "template"]),
});

/**
 * 单独更新「站点素材」（2026-09-10，方向 2）。
 *
 * 不放进 `operations`：素材不是草稿内容，**不该 bump revision**——
 * 否则用户只想补充公司简介，却被当成一次草稿修改，可能撞上冲突。
 */
const sourceMaterialSchema = z.object({
  sourceMaterial: z.string().max(20000),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const parsed = sourceMaterialSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid source material", details: parsed.error.flatten() }, { status: 400 });
  const { siteId } = await params;
  const saved = await setSiteSourceMaterial(siteId, parsed.data.sourceMaterial);
  return Response.json({ ok: true, ...saved });
}

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const { siteId } = await params;
  return Response.json(await getSite(siteId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  /**
   * === B3 宽修：坏形状从"整批 400"改为"拒单条 + 其余保留" ===
   *
   * 此前 `z.array(siteOperationSchema)` 是全有全无：一条坏 locale 让**整批** 400
   * （实测：`operations.1.locale` 一处不合 → 整个请求被拒，用户丢全部编辑）。
   * 这与 `validateGenerationOperations` 的"拒单条保其余"语义不一致，
   * 也是 B3 明文禁止的形态。
   *
   * 现在：外层只校验 items 是数组 → 逐条 `validateOperationShapes` 过滤 →
   * 被拒的条目随响应返回（`rejected`），用户看得见哪条没生效、为什么。
   */
  const envelope = await request.json().catch(() => null);
  const items = (envelope as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) {
    return Response.json({ error: "Invalid draft update", details: "operations 必须是 1-25 条的数组" }, { status: 400 });
  }
  const shapeChecked = validateOperationShapes(items);
  if (shapeChecked.valid.length === 0) {
    return Response.json({ error: "Invalid draft update", rejected: shapeChecked.rejected }, { status: 400 });
  }
  const parsed = updateSchema.safeParse({ ...(envelope as Record<string, unknown>), operations: shapeChecked.valid });
  if (!parsed.success) return Response.json({ error: "Invalid draft update", details: parsed.error.flatten() }, { status: 400 });
  for (const operation of parsed.data.operations) {
    if (operation.op === "replace_draft") {
      const validDraft = siteDraftSchema.safeParse(operation.draft);
      if (!validDraft.success) return Response.json({ error: "Invalid replacement draft", details: validDraft.error.flatten() }, { status: 400 });
      operation.draft = validDraft.data;
    }
  }
  const { siteId } = await params;
  /*
   * 文案可读长度闸门（2026-09-11）。
   *
   * 此前 PUT /draft 只做 schema 校验：schema 的 `set_text.value` 上限是 1000 字，
   * 而发布质检（content-quality）按可读长度（标题 15 / 正文 40）判 block
   * → **用户能在就地编辑里存进去，发布时才被拦**，中间没有任何提示。
   *
   * 这里返回明确原因而不是静默丢弃：就地编辑有输入框，用户能当场改短。
   * 只查长度语义、不复用 validateAIOperations/validateGenerationOperations——
   * 那两个还带"换模板必须显式""生成 scope"等对话/生成语义，不适用于直接编辑。
   */
  for (const operation of parsed.data.operations) {
    const reason = checkCopyLength(operation);
    if (reason) return Response.json({ error: reason, code: "copy_too_long" }, { status: 422 });
  }
  try {
    const result = await commitOperations({ siteId, ...parsed.data });
    if (result.status === "conflict") return Response.json({ error: "revision_conflict", ...snapshot(result.record) }, { status: 409 });
    return Response.json({
      status: result.status,
      ...(result.status === "applied" ? { changeSet: result.changeSet } : {}),
      /**
       * B3：被拒条目必须对用户可见——静默丢弃就是"AI 说改了但没改"那一族。
       *
       * ⚠️ **无条件存在**（用户 2026-09-13 裁决 ②）：即使为空也要有这个字段。
       * 此前写成条件展开（只有非空才带），未来一次改造就可能把它整个吞掉，
       * 而消费方（见 T-18）只会看到 `undefined` 静静地什么都不显示。
       * 断言：`tests/draft-contract.test.ts` 的 200 响应体必含 `rejected` 数组。
       */
      rejected: shapeChecked.rejected,
      ...snapshot(result.record),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Draft update failed" }, { status: 422 });
  }
}
