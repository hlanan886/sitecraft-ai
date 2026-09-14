/**
 * 产物契约断言的单元测试。
 *
 * 为什么这些用例长得"很具体"：每一条都对应真机上**实际观察到**的失败，
 * 不是假想场景。来源：
 * - 首屏「待补充」：2026-09-10 实测 siteId=aea218b2（注塑模具站）
 * - about 等于 defaultDraft：同日实测 siteId=38cb54fd（五金件站）
 * - products 被静默隐藏：3/3 个实测站点
 *
 * 这些测试的价值不在于"覆盖分支"，而在于把真机失败固化成回归防线。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkDraftContract, hardViolations, formatViolations } from "../e2e/helpers/draft-contract.ts";
import { cloneDraft, defaultDraft } from "../lib/site-document.ts";

/** 一个"AI 干了活"的干净草稿：所有创意文案都被覆盖过了 */
function filledDraft() {
  const draft = cloneDraft(defaultDraft);
  draft.content.hero.title.zh = "精密五金件加工，稳定交付全球";
  draft.content.hero.cta.zh = "获取报价";
  draft.content.about.body.zh = "专注精密五金件加工与出口，服务欧洲工程机械客户。";
  return draft;
}

test("干净草稿无任何违规", () => {
  const violations = checkDraftContract(filledDraft(), "zh");
  assert.deepEqual(violations, [], formatViolations(violations));
});

test("真机复现①：首屏标题是「待补充」→ 硬失败", () => {
  const draft = filledDraft();
  draft.content.hero.title.zh = "待补充";
  const violations = hardViolations(checkDraftContract(draft, "zh"));
  assert.ok(
    violations.some((v) => v.rule === "placeholder-copy:hero.title"),
    `应命中 placeholder-copy:hero.title，实际：${formatViolations(violations)}`,
  );
});

test("真机复现②：about 正文等于 defaultDraft → 硬失败", () => {
  const draft = filledDraft();
  draft.content.about.body.zh = defaultDraft.content.about.body.zh; // AI 没覆盖
  const violations = hardViolations(checkDraftContract(draft, "zh"));
  assert.ok(
    violations.some((v) => v.rule === "default-draft-leak:about.body"),
    `应命中 default-draft-leak:about.body，实际：${formatViolations(violations)}`,
  );
});

test("真机复现③：中文站首屏混入英文 demo → 硬失败", () => {
  const draft = filledDraft();
  draft.content.hero.title.zh = "Built for the next standard.";
  const violations = hardViolations(checkDraftContract(draft, "zh"));
  assert.ok(
    violations.some((v) => v.rule === "english-demo-leak:hero.title"),
    `应命中 english-demo-leak，实际：${formatViolations(violations)}`,
  );
});

test("真机复现④：products 被隐藏 → 软警告（不拦，但记录）", () => {
  const draft = filledDraft();
  draft.hiddenSections = ["products"];
  const violations = checkDraftContract(draft, "zh");
  const hiddenRule = violations.find((v) => v.rule === "hidden-declared-section:products");
  assert.ok(hiddenRule, "应记录 products 被隐藏");
  assert.equal(hiddenRule.severity, "soft", "隐藏产品板块可能是设计内行为，不应硬失败");
  assert.equal(hardViolations(violations).length, 0, "软警告不应计入硬失败");
});

test("企业事实类槽位的「待补充」不算违规（设计内诚实缺口）", () => {
  // 电话/邮箱本就不该编造，isPlaceholderValue 的标准只作用于我们检查的创意槽位；
  // 这里断言：创意槽位干净时，即使草稿别处有占位符也不误报。
  const draft = filledDraft();
  draft.content.contact = {
    ...defaultDraft.content.contact,
    phone: "待补充",
    email: "待补充",
  };
  const violations = hardViolations(checkDraftContract(draft, "zh"));
  assert.deepEqual(violations, [], `联系方式占位不该误报：${formatViolations(violations)}`);
});

test("空值不触发占位符规则（空是另一条规则的事）", () => {
  const draft = filledDraft();
  draft.content.hero.title.zh = "";
  const violations = checkDraftContract(draft, "zh");
  assert.equal(
    violations.filter((v) => v.rule === "placeholder-copy:hero.title").length,
    0,
    "空值不该被占位符规则重复计一次",
  );
});

test("英文站用 en 判定，不误伤中文内容", () => {
  const draft = cloneDraft(defaultDraft);
  draft.content.hero.title.en = "Precision hardware components for global OEMs";
  draft.content.hero.cta.en = "Request a quote";
  draft.content.about.body.en = "Focused on precision hardware manufacturing and export.";
  const violations = checkDraftContract(draft, "en");
  // en 站不该跑中文 demo 泄漏检查
  assert.ok(
    !violations.some((v) => v.rule.startsWith("english-demo-leak")),
    `en 站不该做中文 demo 泄漏检查：${formatViolations(violations)}`,
  );
});

test("formatViolations 无违规时给出明确通过标记", () => {
  assert.match(formatViolations([]), /全部通过/);
});
