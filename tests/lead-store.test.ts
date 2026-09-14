import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createFileLeadStore,
  createMemoryLeadStore,
  normalizeLeadPayload,
  type LeadInput,
} from "../lib/lead-store.ts";

const baseLead: LeadInput = {
  siteKey: "demo",
  name: "张三",
  email: "sales@example.com",
  company: "示例公司",
  message: "希望了解产品交期",
  honeypot: "",
  idempotencyKey: "request-001",
  source: "published",
};

test("normalizeLeadPayload accepts website honeypot alias and trims fields", () => {
  const parsed = normalizeLeadPayload({
    name: "  张三  ",
    email: " sales@example.com ",
    company: "  示例公司 ",
    message: "  希望了解产品交期  ",
    website: "",
    idempotencyKey: " request-001 ",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data, {
      name: "张三",
      email: "sales@example.com",
      company: "示例公司",
      message: "希望了解产品交期",
      honeypot: "",
      idempotencyKey: "request-001",
    });
  }
});

test("normalizeLeadPayload rejects malformed input without throwing", () => {
  const parsed = normalizeLeadPayload({ name: "", email: "not-an-email", message: "" });
  assert.equal(parsed.success, false);
});

test("memory lead store is idempotent for the same site and key", async () => {
  const store = createMemoryLeadStore();
  const first = await store.create(baseLead);
  const duplicate = await store.create({ ...baseLead, name: "李四" });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.lead.id, first.lead.id);
  assert.equal(duplicate.lead.name, "张三");
  assert.equal((await store.list({ siteKey: "demo" })).length, 1);
});

test("memory lead store filters by site and status and updates status", async () => {
  const store = createMemoryLeadStore();
  const created = await store.create(baseLead);
  await store.create({ ...baseLead, idempotencyKey: "request-002", siteKey: "other" });

  assert.equal((await store.list({ siteKey: "demo", status: "new" })).length, 1);
  assert.equal((await store.list({ siteKey: "demo", status: "contacted" })).length, 0);

  const updated = await store.updateStatus({ siteKey: "demo", leadId: created.lead.id, status: "contacted" });
  assert.equal(updated?.status, "contacted");
  assert.equal((await store.list({ siteKey: "demo", status: "new" })).length, 0);
  assert.equal((await store.list({ siteKey: "demo", status: "contacted" })).length, 1);
  assert.equal(await store.updateStatus({ siteKey: "demo", leadId: "missing", status: "archived" }), null);
});

// ===== 文件存储：修复「询盘闭环在 file 模式下闭锁」（2026-09-10）=====
//
// 回归背景：`isLeadStoreEnabled()` 只认 Postgres，三个路由只走 `postgresLeadStore`，
// 本机 `SITE_STORE=file` 时公开页表单提交必然 503 —— 当着客户演示询盘会失败。
// 下面用**真实文件读写**验证修复（而非只断言内存对象），并跨实例验证持久化。

async function withTempStore(run: (store: ReturnType<typeof createFileLeadStore>, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "sitecraft-leads-"));
  try {
    await run(createFileLeadStore({ rootDir: dir }), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("file lead store persists a submission and reads it back across instances", async () => {
  await withTempStore(async (store, dir) => {
    const created = await store.create(baseLead);
    assert.equal(created.created, true);
    assert.equal(created.lead.status, "new");

    // 新实例 = 模拟进程重启：必须仍能读到（证明真的落盘，而非只在内存）
    const reopened = createFileLeadStore({ rootDir: dir });
    const leads = await reopened.list({ siteKey: "demo" });
    assert.equal(leads.length, 1);
    assert.equal(leads[0].email, "sales@example.com");
    assert.equal(leads[0].message, "希望了解产品交期");
  });
});

test("file lead store keeps idempotency and status updates across instances", async () => {
  await withTempStore(async (store, dir) => {
    const first = await store.create(baseLead);
    // 同 site + 同 idempotencyKey 重复提交（真实场景：访客重复点提交）
    const duplicate = await store.create({ ...baseLead, name: "李四" });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.lead.id, first.lead.id);

    await store.updateStatus({ siteKey: "demo", leadId: first.lead.id, status: "contacted" });

    const reopened = createFileLeadStore({ rootDir: dir });
    // 重启后幂等仍生效（证明 idempotencyKey 也被持久化）
    const again = await reopened.create({ ...baseLead, name: "王五" });
    assert.equal(again.created, false);
    assert.equal(again.lead.name, "张三");
    // 状态流转也持久化
    assert.equal((await reopened.list({ siteKey: "demo", status: "contacted" })).length, 1);
    assert.equal((await reopened.list({ siteKey: "demo", status: "new" })).length, 0);
  });
});

test("file lead store isolates sites into separate files", async () => {
  await withTempStore(async (store) => {
    await store.create(baseLead);
    await store.create({ ...baseLead, siteKey: "other", idempotencyKey: "request-002" });
    assert.equal((await store.list({ siteKey: "demo" })).length, 1);
    assert.equal((await store.list({ siteKey: "other" })).length, 1);
  });
});
