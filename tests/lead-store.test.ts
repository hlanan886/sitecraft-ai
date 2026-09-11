import assert from "node:assert/strict";
import test from "node:test";
import {
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
