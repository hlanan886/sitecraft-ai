import assert from "node:assert/strict";
import test from "node:test";

/**
 * 阶段 4 · 往返验收（**Postgres 后端**）：旧名读入 → undo 重放 → 新名落盘 → 再读。
 *
 * 用户裁决第 3 条要求文件 / PG 各一个样本；文件侧见 `site-store-op-rename.test.ts`。
 *
 * ## 这个文件为什么"连不上就 skip"而不是失败
 *
 * 项目里绝大多数测试**不需要数据库**，`npm test` 必须在无库环境下全绿
 * （开发机、CI 都跑它）。所以这里：
 *  - **不读 `.env.local`**（用户裁决第 5 条：那里的 `DATABASE_URL` 仍指 5432，维持不动）；
 *  - 只认**显式传入**的 `DATABASE_URL`——这同时保证了不会误连生产库；
 *  - 连不上 → `t.skip()` 并打印原因，**不算失败**。
 *
 * 跑法（用户已把 PG 起在宿主机 5433）：
 *
 * ```bash
 * DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/site_studio \
 *   node --test --experimental-strip-types tests/site-store-op-rename-pg.test.ts
 * ```
 *
 * ## 安全
 *
 * 全部数据都写在**本用例自己的** site_id 下（`phase4-op-rename-probe`），
 * 结束时删掉该行。**绝不触碰**库里已有的 845 行。
 */

const SITE_ID = "phase4-op-rename-probe";
const SAMPLE_TITLE = "PG 往返样本标题";
const databaseUrl = process.env.DATABASE_URL?.trim();

test("PG 后端往返：旧名读入 → undo 重放 → 新名落盘 → 再读", async (t) => {
  if (!databaseUrl) {
    t.skip("未提供 DATABASE_URL —— 跳过（本用例需要显式指定的库，不读 .env.local）");
    return;
  }

  // site-store 的 usePostgres 在**模块加载时**由 SITE_STORE/NODE_ENV 决定，
  // PG 往返必须同时让它是 postgres。环境变量在我们的动态 import 之前设好。
  process.env.SITE_STORE = "postgres";
  process.env.DATABASE_URL = databaseUrl;

  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    t.skip(`连不上 DATABASE_URL 指定的库（${new URL(databaseUrl).host}）：${reason}`);
    return;
  }

  try {
    const { commitOperations, getSite, moveHistory } = await import("../lib/site-store.ts");
    const { defaultDraft } = await import("../lib/site-document.ts");

    // 清理：本用例只碰这一行。
    const cleanup = () => client.query("DELETE FROM sitecraft_sites WHERE site_id = $1", [SITE_ID]);
    await cleanup();

    // ---- ① 造站点 ----
    // 直接播种一个 revision 0 的草稿，避免 getSite 的 upsert 语义带来的额外历史。
    await client.query(
      `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at)
       VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, NOW())`,
      [process.env.DEFAULT_WORKSPACE_ID || "demo", SITE_ID, JSON.stringify(defaultDraft)],
    );

    const before = await getSite(SITE_ID);
    assert.equal(before.canUndo, false, "前置：播种后没有历史");

    // ---- ② 落一批操作，再把库里的 op 名改成旧名 ----
    const first = await commitOperations({
      siteId: SITE_ID,
      baseRevision: before.draft.revision,
      operations: [{ op: "update_item", section: "features", index: 0, locale: "zh", title: SAMPLE_TITLE }],
      summary: "PG 往返一次改动",
      source: "ai",
    });
    assert.equal(first.status, "applied");

    // 用 jsonb 原地把两个数组里每个元素的 op 都改成旧名。
    await client.query(
      `UPDATE sitecraft_sites
          SET history = (
            SELECT jsonb_agg(
              jsonb_set(
                jsonb_set(cs, '{operations}', (
                  SELECT jsonb_agg(jsonb_set(e, '{op}', '"update_card"')) FROM jsonb_array_elements(cs->'operations') e
                )),
                '{inverseOperations}', (
                  SELECT jsonb_agg(jsonb_set(e, '{op}', '"update_card"')) FROM jsonb_array_elements(cs->'inverseOperations') e
                )
              ) ORDER BY ord
            ) FROM jsonb_array_elements(history) WITH ORDINALITY AS t(cs, ord)
          )
        WHERE site_id = $1`,
      [SITE_ID],
    );
    const aged = await client.query(
      `SELECT cs->'operations'->0->>'op' AS fwd, cs->'inverseOperations'->0->>'op' AS inv
         FROM sitecraft_sites s, jsonb_array_elements(s.history) cs WHERE s.site_id = $1`,
      [SITE_ID],
    );
    assert.equal(aged.rows[0]?.fwd, "update_card", "前置：库里确实写成了旧名");
    assert.equal(aged.rows[0]?.inv, "update_card");

    // ---- ③ 读回来（走 rowToRecord 的归一化）----
    const reread = await getSite(SITE_ID);
    assert.equal(reread.canUndo, true, "含旧名历史的站点必须仍可 undo");

    // ---- ④ undo 重放：归一化没接上就会静默空操作，所以看草稿真的变了 ----
    const undone = await moveHistory(SITE_ID, "undo");
    assert.equal(undone.status, "applied", "旧名历史必须能重放");
    assert.notEqual(
      undone.record.draft.content.features.items[0].title.zh,
      SAMPLE_TITLE,
      "undo 必须真的改回去",
    );

    // ---- ⑤ 新名落盘 ----
    const second = await commitOperations({
      siteId: SITE_ID,
      baseRevision: undone.record.draft.revision,
      operations: [{ op: "update_item", section: "features", index: 0, locale: "zh", title: "PG 第二次改" }],
      summary: "PG 往返第二次改动",
      source: "ai",
    });
    assert.equal(second.status, "applied");

    const stored = await client.query(
      `SELECT cs->'operations'->0->>'op' AS fwd FROM sitecraft_sites s, jsonb_array_elements(s.history) cs
        WHERE s.site_id = $1 ORDER BY cs->>'revision' DESC LIMIT 1`,
      [SITE_ID],
    );
    assert.equal(stored.rows[0]?.fwd, "update_item", "写入路径只写新名");

    // ---- ⑥ 再读 ----
    const final = await getSite(SITE_ID);
    assert.equal(final.draft.content.features.items[0].title.zh, "PG 第二次改");
    assert.equal(final.canUndo, true);
  } finally {
    await client.query("DELETE FROM sitecraft_sites WHERE site_id = $1", [SITE_ID]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
});
