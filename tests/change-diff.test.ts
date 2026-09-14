import assert from "node:assert/strict";
import test from "node:test";

import { buildChangeDiff } from "../lib/change-diff.ts";
import { defaultDraft } from "../lib/site-document.ts";
import type { SiteOperation } from "../lib/site-operations.ts";

test("buildChangeDiff returns field-level before and after values for text and card edits", () => {
  const before = structuredClone(defaultDraft);
  before.content.hero.title.zh = "原首屏标题";
  before.content.services.items[1].title.zh = "原服务标题";
  const operations: SiteOperation[] = [
    { op: "set_text", target: "hero.title", locale: "zh", value: "新首屏标题" },
    { op: "update_item", section: "services", index: 1, itemId: before.content.services.items[1].id, locale: "zh", title: "新服务标题" },
  ];

  assert.deepEqual(buildChangeDiff(operations, before), [
    { target: "hero.title.zh", label: "首屏标题（中文）", before: "原首屏标题", after: "新首屏标题" },
    { target: "services.items.1.title.zh", label: "第 2 个服务标题（中文）", before: "原服务标题", after: "新服务标题" },
  ]);
});

test("buildChangeDiff uses stable itemId and reports section visibility changes", () => {
  const before = structuredClone(defaultDraft);
  const item = before.content.services.items[0];
  const operations: SiteOperation[] = [
    { op: "update_item", section: "services", index: 8, itemId: item.id, locale: "en", body: "New service description" },
    { op: "set_section_visibility", section: "contact", visible: false },
  ];

  assert.deepEqual(buildChangeDiff(operations, before), [
    { target: "services.items.0.body.en", label: "第 1 个服务说明（英文）", before: item.body.en, after: "New service description" },
    { target: "contact.visibility", label: "联系区块显示状态", before: "显示", after: "隐藏" },
  ]);
});

test("buildChangeDiff never blocks a committed change when an old target cannot be resolved", () => {
  const operations: SiteOperation[] = [
    { op: "update_item", section: "services", index: 0, itemId: "removed-item", locale: "zh", title: "新标题" },
  ];
  assert.deepEqual(buildChangeDiff(operations, defaultDraft), []);
});
