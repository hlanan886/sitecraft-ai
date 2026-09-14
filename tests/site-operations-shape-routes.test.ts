/**
 * B3 宽修 · 端到端形状闸门（`/chat` 与 `/draft` 两条路）。
 *
 * ## 为什么单独成文件
 *
 * 用户 2026-09-13 裁决：调用点后果矩阵里 `/chat` 与 `/draft` 两条路各补一条
 * 「坏 op 被拒、其余保留」的端到端断言。单测（`site-operations-shape.test.ts`）
 * 证明的是**函数**语义；这里证明的是**路由**语义——坏操作从 HTTP 进去之后，
 * 到底是被拒单条、还是炸了整批、还是静默丢了。
 *
 * ## 两条路的既有形态（实测取证，2026-09-13）
 *
 * | 路 | 宽修前 | 宽修后 |
 * |---|---|---|
 * | `/draft` | `z.array(siteOperationSchema)` 全有全无：一条坏 locale → **整批 400** | 逐条过滤 → 拒单条 + `rejected[]` 随响应返回 |
 * | `/chat` | 模型 op 过语义校验但**从不跑 shape schema**；坏形状走到 `applySiteOperations` 才炸（或静默） | 出口形状闸门：拒单条 + 并入既有 `rejected[]` |
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS_HEADERS, setupSubstitutedRoute } from "./helpers/substitution.ts";

/* ------------------------------------------------------------------ *
 * ① /draft：坏 op 被拒、其余保留
 * ------------------------------------------------------------------ */

const draftCtx = await setupSubstitutedRoute(
  {},
  new URL("../app/api/sites/[siteId]/draft/route.ts", import.meta.url).href,
);

test("draft：一条坏 locale，其余操作照常生效，坏的那条随响应返回", async () => {
  const mod = draftCtx.module as {
    GET: (r: Request, c: { params: Promise<{ siteId: string }> }) => Promise<Response>;
    PUT: (r: Request, c: { params: Promise<{ siteId: string }> }) => Promise<Response>;
  };
  const params = { params: Promise.resolve({ siteId: "site-b3" }) };

  // 先按真实流程取当前 revision——写死 baseRevision=0 会先撞冲突，
  // 那就测不到形状闸门了（实测：409 revision_conflict）。
  const current = (await (await mod.GET(
    new Request("http://localhost/api/sites/site-b3/draft", { headers: ACCESS_HEADERS }),
    params,
  )).json()) as { draft?: { revision?: number } };
  const baseRevision = current.draft?.revision ?? 0;

  const response = await mod.PUT(
    new Request("http://localhost/api/sites/site-b3/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({
        baseRevision,
        summary: "B3 端到端：一好一坏",
        source: "manual",
        operations: [
          { op: "set_text", target: "hero.title", locale: "zh", value: "这条必须生效" },
          { op: "set_text", target: "hero.title", locale: "fr", value: "这条必须被拒" },
        ],
      }),
    }),
    params,
  );
  const body = (await response.json()) as { status?: string; rejected?: string[]; draft?: { content: { hero: { title: { zh: string } } } } };
  console.log("DRAFT-E2E", JSON.stringify({ status: response.status, rejected: body.rejected, heroZh: body.draft?.content?.hero?.title?.zh }));

  assert.notEqual(response.status, 400, "坏单条不该把整批打成 400（宽修前的形态）");
  /**
   * 用户 2026-09-13 裁决 ②：**200 响应体必含 `rejected` 数组字段**——
   * 即便本轮没有坏条目也要在（放未来改造把字段整个吞掉，消费方见 T-18）。
   */
  assert.ok(Array.isArray(body.rejected), "200 响应必须带 rejected 数组字段（无条件存在）");
  assert.equal(body.rejected?.length, 1, "坏的那条必须被拒且可见");
  assert.match(body.rejected![0], /[一-龥]/, "拒绝理由要可读（中文）");
  assert.match(body.rejected![0], /fr/, "理由要点出坏值");
  assert.equal(body.draft?.content?.hero?.title?.zh, "这条必须生效", "好操作必须真的落盘");
});

/* ------------------------------------------------------------------ *
 * ② /chat：出口形状闸门（模型产出坏形状时）
 * ------------------------------------------------------------------ */

/**
 * ⚠️ **只建一个沙箱**（2026-09-13 实测教训）：`setupSubstitutedRoute` 会 `chdir`，
 * 建第二个 ctx 时 cwd 被改到新沙箱，第一个 ctx 的 teardown 再 `chdir` 回去时
 * 目标目录已被删 → `ENOENT`。本文件两条断言共用同一个 ctx 即可
 * （chat 那条不依赖路由模块，`/draft` 那条已在上面用完）。
 */

test("chat：模型产出坏形状时，形状闸门在出口拦下（拒单条保其余）", async () => {
  /**
   * 这里测的是**出口闸门本身**：直接调 `validateOperationShapes` 在
   * `validateGenerationOperations` 出口的接线（同一条函数被 `/chat` 的
   * 生成路径复用）。完整的 SSE 端到端要打真模型，超出本批范围——
   * 但"模型给了坏形状会怎样"这个问题的答案由本断言钉死。
   */
  const { validateGenerationOperations } = await import("../lib/site-operations.ts");
  const { templates } = await import("../lib/site-model.ts");
  const ids = new Set(templates.map((t) => t.id));

  const result = validateGenerationOperations([
    { op: "set_text", target: "hero.title", locale: "zh", value: "模型给的这条是对的" },
    { op: "update_item", section: "features", index: 0, locale: "de", title: "模型给的坏 locale" },
    { op: "set_text", target: "hero.subtitle", locale: "zh", value: "第三条也要保留" },
  ] as never[], ids);

  console.log("CHAT-E2E", JSON.stringify({ accepted: result.operations.length, rejected: result.rejected }));

  assert.equal(result.operations.length, 2, "两条合法操作必须保留（拒单条保其余）");
  assert.equal(result.rejected.length, 1, "坏 locale 必须被拒一条");
  assert.match(result.rejected[0], /[一-龥]/, "拒绝理由要可读（中文）");
});

test("draft：无坏条目时 rejected 字段仍存在（空数组）——防未来改造吞字段", async () => {
  const mod = draftCtx.module as {
    GET: (r: Request, c: { params: Promise<{ siteId: string }> }) => Promise<Response>;
    PUT: (r: Request, c: { params: Promise<{ siteId: string }> }) => Promise<Response>;
  };
  const params = { params: Promise.resolve({ siteId: "site-b3-allgood" }) };
  const current = (await (await mod.GET(
    new Request("http://localhost/api/sites/site-b3-allgood/draft", { headers: ACCESS_HEADERS }),
    params,
  )).json()) as { draft?: { revision?: number } };

  const response = await mod.PUT(
    new Request("http://localhost/api/sites/site-b3-allgood/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({
        baseRevision: current.draft?.revision ?? 0,
        summary: "B3：全好，无拒绝",
        source: "manual",
        operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "全好的一条" }],
      }),
    }),
    params,
  );
  const body = (await response.json()) as { rejected?: unknown };
  console.log("DRAFT-E2E-CLEAN", JSON.stringify({ status: response.status, rejected: body.rejected }));

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.rejected), "即使没有坏条目，rejected 也必须是数组字段");
  assert.equal((body.rejected as unknown[]).length, 0, "本轮应无拒绝");
});

test.after(async () => {
  await draftCtx.teardown();
});
