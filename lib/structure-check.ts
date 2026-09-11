/**
 * 模板结构破坏检测（Q2）
 *
 * 纯函数，只用相对导入（可被 npm test 直接测，不触网）。
 * 职责：对比"模板原始结构"与"AI 操作后结构"，检测 AI 是否破坏了模板结构。
 *
 * 结构由两部分定义：
 * 1. sectionOrder：5 个板块的顺序（about/features/services/products/contact）
 * 2. 卡片数：features/services 的 items 数量（模板有固定数量，AI 不应大幅增删）
 *
 * 检测原则：AI 填充内容是允许的（set_text/update_card），
 * 但改动"结构本身"（reorder/增删卡片）若超出合理范围 → 标注异常。
 */

import { type SectionKey } from "./site-document.ts";

export type StructureIssue = {
  kind: "section_order" | "card_count";
  detail: string;
  severity: "high" | "medium";
};

/** 判断两个板块顺序是否一致 */
export function sameSectionOrder(a: SectionKey[], b: SectionKey[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** 判断板块顺序是否"合法"（5 个板块各出现一次，无重复无缺失） */
export function isValidSectionOrder(order: SectionKey[]): boolean {
  const expected = new Set<SectionKey>(["about", "features", "services", "products", "contact"]);
  if (order.length !== expected.size) return false;
  const seen = new Set<SectionKey>();
  for (const s of order) {
    if (!expected.has(s) || seen.has(s)) return false;
    seen.add(s);
  }
  return true;
}

/**
 * 检测草稿结构问题。
 * @param draft 当前草稿（操作后）
 * @param options.templateCardCounts 模板默认卡片数（features/services 的 items 数量），缺省用合理区间
 * 注意：只读 sectionOrder 和 features/services 的 items 长度，不依赖完整草稿结构（便于测试/嵌入）
 */
export function checkDraftStructure(
  draft: {
    sectionOrder: SectionKey[];
    content: {
      features: { items: unknown[] };
      services: { items: unknown[] };
    };
  },
  options?: { features?: number; services?: number },
): StructureIssue[] {
  const issues: StructureIssue[] = [];

  // 1. sectionOrder 合法性（不应有重复/缺失/非白名单）
  if (!isValidSectionOrder(draft.sectionOrder)) {
    issues.push({ kind: "section_order", detail: `板块顺序异常：${draft.sectionOrder.join("→")}`, severity: "high" });
  }

  // 2. 卡片数：features/services 的 items 数量相对模板默认是否异常
  const expected = { features: options?.features ?? 3, services: options?.services ?? 3 };
  for (const section of ["features", "services"] as const) {
    const count = draft.content[section].items?.length ?? 0;
    const base = expected[section];
    // 允许 ±2 张（AI 适度增删），超出 → 标注
    if (Math.abs(count - base) > 2) {
      issues.push({
        kind: "card_count",
        detail: `${section} 卡片数 ${count} 张，模板默认 ${base} 张，偏差过大`,
        severity: count === 0 ? "high" : "medium",
      });
    }
  }

  return issues;
}
