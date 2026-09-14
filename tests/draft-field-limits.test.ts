/**
 * 草稿字段上限的**单源与防回退**守卫（P-0，2026-09-11）。
 *
 * ## 修的是什么
 *
 * 修复前是**写入宽松 / 读取严格**：
 *  - 写入走 `applySiteOperations`，**从不跑 `siteDraftSchema`**；`set_text` 只约束 `value ≤ 1000`。
 *  - 读取走 `normalizeDraft`，`safeParse` 失败 → `cloneDraft(defaultDraft)` + 只回填 7 个字段
 *    → `about`/`features`/`services`/`contact`/`navigation` **全部重置成 Forge 演示文案**，**无报错**。
 *
 * 实测复现：把 `industry` 写到 130 字 → 写入成功 → 下次读取，用户写的企业简介与优势标题**全部消失**。
 *
 * 本文件锁住两件事：
 *  1. `DRAFT_FIELD_MAX_LENGTH` 是这些字段上限的**唯一来源**，`siteDraftSchema` 必须与它一致；
 *  2. `checkCopyLength` 在**写入前**就拦下超限，而不是等读取时整站回退。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { cloneDraft, defaultDraft, siteDraftSchema } from "../lib/site-document.ts";
import { DRAFT_FIELD_MAX_LENGTH, draftFieldMaxLength } from "../lib/draft-field-limits.ts";
import { checkCopyLength, type SiteOperation } from "../lib/site-operations.ts";

/** 一个"各受管字段都恰好在上限"的完整草稿：以 defaultDraft 为底，避免手写漏字段 */
function draftAtLimits() {
  const draft = cloneDraft(defaultDraft);
  draft.siteName = "名".repeat(DRAFT_FIELD_MAX_LENGTH.siteName);
  draft.companyName = "名".repeat(DRAFT_FIELD_MAX_LENGTH.companyName);
  draft.industry = "行".repeat(DRAFT_FIELD_MAX_LENGTH.industry);
  draft.goal = "目".repeat(DRAFT_FIELD_MAX_LENGTH.goal);
  draft.content.contact.email = "e".repeat(DRAFT_FIELD_MAX_LENGTH["contact.email"]);
  draft.content.contact.phone = "p".repeat(DRAFT_FIELD_MAX_LENGTH["contact.phone"]);
  return draft;
}

function op(target: string, value: string): SiteOperation {
  return { op: "set_text", target, value } as SiteOperation;
}

test("DRAFT_FIELD_MAX_LENGTH 是唯一来源：siteDraftSchema 与它逐项一致（防漂移）", () => {
  const atLimit = draftAtLimits();
  const parsed = siteDraftSchema.safeParse(atLimit);
  assert.equal(
    parsed.success,
    true,
    `恰好在上限的草稿应通过 schema——若失败说明 siteDraftSchema 与 DRAFT_FIELD_MAX_LENGTH 漂移了：${JSON.stringify(parsed.error?.issues.slice(0, 3))}`,
  );

  // 每个受管字段 +1 字符都应失败（证明 schema 确实在用同一份上限）
  const overrides: Record<string, (d: ReturnType<typeof draftAtLimits>) => void> = {
    siteName: (d) => { d.siteName = "名".repeat(DRAFT_FIELD_MAX_LENGTH.siteName + 1); },
    companyName: (d) => { d.companyName = "名".repeat(DRAFT_FIELD_MAX_LENGTH.companyName + 1); },
    industry: (d) => { d.industry = "行".repeat(DRAFT_FIELD_MAX_LENGTH.industry + 1); },
    goal: (d) => { d.goal = "目".repeat(DRAFT_FIELD_MAX_LENGTH.goal + 1); },
    "contact.email": (d) => { d.content.contact.email = "e".repeat(DRAFT_FIELD_MAX_LENGTH["contact.email"] + 1); },
    "contact.phone": (d) => { d.content.contact.phone = "p".repeat(DRAFT_FIELD_MAX_LENGTH["contact.phone"] + 1); },
  };
  for (const [field, over] of Object.entries(overrides)) {
    const draft = draftAtLimits();
    over(draft);
    assert.equal(siteDraftSchema.safeParse(draft).success, false, `${field} 超过上限必须被 schema 拒绝`);
  }
});

test("checkCopyLength 在写入前拦下超限字段（P-0 的主防线）", () => {
  // 这些字段**不走**可读性长度（15/40），此前完全无人拦截 → 写入成功、读取整站回退
  for (const [field, limit] of Object.entries(DRAFT_FIELD_MAX_LENGTH)) {
    assert.equal(checkCopyLength(op(field, "字".repeat(limit))), null, `${field} 恰好 ${limit} 应放行`);
    const rejection = checkCopyLength(op(field, "字".repeat(limit + 1)));
    assert.ok(rejection, `${field} 超出 ${limit} 必须被写入闸门拦下`);
    assert.match(rejection, new RegExp(`${limit}`), `拒绝原因应写明上限 ${limit}`);
  }
});

test("可读长度字段仍走原口径，未被字段硬上限误伤", () => {
  // hero.title 有契约容量 160（SLOT_MAX_LENGTH），**不在** DRAFT_FIELD_MAX_LENGTH 里
  assert.equal(draftFieldMaxLength("hero.title"), null);
  assert.equal(draftFieldMaxLength("companyName"), DRAFT_FIELD_MAX_LENGTH.companyName);
  /**
   * 超限仍应被拒——但**按契约容量 160 判**，不再是手写的"可读长度 15"。
   * （2026-09-12：手写的那组 15/40 已删除，长度只剩 `SLOT_MAX_LENGTH` 一个来源。）
   */
  assert.ok(checkCopyLength(op("hero.title", "超".repeat(200))), "hero.title 超出契约容量应被拒");
  assert.equal(checkCopyLength(op("hero.title", "超".repeat(160))), null, "恰好到契约容量应放行");
});

test("回归：这正是会导致整站静默回退的输入", () => {
  // 130 字 industry（旧行为：写入成功 → normalizeDraft 回退 → about/features 全丢）
  const overIndustry = "工".repeat(DRAFT_FIELD_MAX_LENGTH.industry + 10);
  const rejection = checkCopyLength(op("industry", overIndustry));
  assert.ok(rejection, "必须在写入前就拦下，而不是等读取时把整站回退成演示文案");

  // 同时确认：若真让它落盘，schema 确实会失败（即回退确实会发生）——证明这道闸门的必要性
  const wouldParse = siteDraftSchema.safeParse({ schemaVersion: 2, industry: overIndustry });
  assert.equal(wouldParse.success, false, "超限草稿确实无法通过 schema（这就是回退的触发条件）");
});
