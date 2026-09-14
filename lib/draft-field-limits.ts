/**
 * 草稿字段的**唯一上限来源**（2026-09-11，P-0 修复）。
 *
 * ## 为什么需要它
 *
 * 修复前存在**写入宽松 / 读取严格**的错配，会导致**静默数据丢失**：
 *  - **写入**：`site-store.ts` 的 `commitOperations` → `applySiteOperations`，**从不跑 `siteDraftSchema`**；
 *    `set_text` 的 schema 只约束 `value ≤ 1000`，**不按 target 复查字段上限**。
 *  - **读取**：`normalizeDraft`（`site-document.ts`）一旦 `safeParse` 失败，就
 *    `cloneDraft(defaultDraft)` 并**只回填 7 个字段**——`about`/`features`/`services`/
 *    `contact`/`navigation` **全部重置成 Forge 演示文案**。
 *
 * 实测复现（2026-09-11）：把 `industry` 写到 130 字 →
 * 写入成功 → 下次读取 `siteDraftSchema` 失败 → **用户写的企业简介与优势标题全部消失**，无任何报错。
 *
 * ## 用法
 *
 * 本表是**这些字段在 `siteDraftSchema` 里的 max 的唯一来源**：
 *  - `site-document.ts` 用它构造 schema（保证两边永远相等）；
 *  - `site-operations.ts` 的 `checkCopyLength` 用它做**写入前拦截**，超限当场拒绝并给可读原因。
 *
 * `tests/draft-field-limits.test.ts` 断言两边一致，防再次漂移。
 *
 * ⚠️ 只管**非本地化**字段（`set_text` 里那些不带 locale 的 target）。
 * 本地化文案（hero/about/features 等）的上限走槽位契约 `SLOT_MAX_LENGTH`，不在这里。
 */
export const DRAFT_FIELD_MAX_LENGTH = Object.freeze({
  siteName: 120,
  companyName: 120,
  industry: 120,
  goal: 500,
  "contact.email": 240,
  "contact.phone": 80,
} as const);

export type DraftLimitedField = keyof typeof DRAFT_FIELD_MAX_LENGTH;

/** 该 target 是否受本表约束；返回 null 表示不受约束（走槽位契约或本地化文案） */
export function draftFieldMaxLength(target: string): number | null {
  return (DRAFT_FIELD_MAX_LENGTH as Record<string, number>)[target] ?? null;
}
