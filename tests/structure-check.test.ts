import assert from "node:assert/strict";
import test from "node:test";
import { checkDraftStructure, sameSectionOrder, isValidSectionOrder } from "../lib/structure-check.ts";
import type { SectionKey } from "../lib/site-document.ts";

const DEFAULT_ORDER: SectionKey[] = ["about", "features", "services", "products", "contact"];

function makeDraft(over: {
  sectionOrder?: SectionKey[];
  content?: { features: { items: unknown[] }; services: { items: unknown[] } };
} = {}) {
  return {
    sectionOrder: over.sectionOrder ?? DEFAULT_ORDER,
    content: over.content ?? {
      features: { items: [{}, {}, {}] },
      services: { items: [{}, {}, {}] },
    },
  };
}

test("sameSectionOrder: detects order difference", () => {
  const a = ["about", "features", "services", "products", "contact"] as const;
  const b = ["about", "services", "features", "products", "contact"] as const;
  assert.equal(sameSectionOrder(a as unknown as SectionKey[], b as unknown as SectionKey[]), false);
  assert.equal(sameSectionOrder(a as unknown as SectionKey[], a as unknown as SectionKey[]), true);
});

test("isValidSectionOrder: rejects duplicates and missing", () => {
  const valid = ["about", "features", "services", "products", "contact"] as const;
  assert.equal(isValidSectionOrder(valid as unknown as SectionKey[]), true);
  // 重复
  assert.equal(isValidSectionOrder(["about", "about", "services", "products", "contact"] as unknown as SectionKey[]), false);
  // 缺失
  assert.equal(isValidSectionOrder(["about", "features", "services", "products"] as unknown as SectionKey[]), false);
  // 非白名单
  assert.equal(isValidSectionOrder(["about", "blog", "services", "products", "contact"] as unknown as SectionKey[]), false);
});

test("checkDraftStructure: valid draft passes", () => {
  const draft = makeDraft();
  assert.equal(checkDraftStructure(draft).length, 0);
});

test("checkDraftStructure: card count far from template default flagged", () => {
  // features 0 张（远少）、services 6 张（远多）
  const draft = makeDraft({ content: { features: { items: [] }, services: { items: [{}, {}, {}, {}, {}, {}] } } });
  const issues = checkDraftStructure(draft);
  assert.ok(issues.some((i) => i.kind === "card_count" && i.detail.includes("features")));
  assert.ok(issues.some((i) => i.kind === "card_count" && i.detail.includes("services")));
});

test("checkDraftStructure: zero cards is high severity", () => {
  const draft = makeDraft({ content: { features: { items: [] }, services: { items: [{}, {}, {}] } } });
  const issues = checkDraftStructure(draft);
  const zero = issues.find((i) => i.detail.includes("features"));
  assert.ok(zero);
  assert.equal(zero.severity, "high");
});

test("checkDraftStructure: legal reorder is not flagged, illegal is", () => {
  // 合法重排（仍是 5 个板块各一次）→ 不 flag
  const reordered = makeDraft({ sectionOrder: ["contact", "about", "features", "services", "products"] });
  assert.equal(checkDraftStructure(reordered).filter((i) => i.kind === "section_order").length, 0);
  // 非法（重复板块）→ flag
  const dup = makeDraft({ sectionOrder: ["about", "about", "services", "products", "contact"] });
  assert.ok(checkDraftStructure(dup).some((i) => i.kind === "section_order"));
});
