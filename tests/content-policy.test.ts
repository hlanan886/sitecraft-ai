import assert from "node:assert/strict";
import test from "node:test";

import {
  POLICY_RULES,
  blockingRuleIds,
  policyDecision,
  policyRule,
  policyRulesText,
  qualityScore,
  type PolicyRuleId,
} from "../lib/content-policy.ts";

/**
 * 同源性测试（红队要求）：验证"提示词 / 质检器 / 发布门"三者确实从同一棵策略树派生。
 *
 * 为什么必须有：策略树只是设计意图，"从同一棵树派生"不是可验证约束。
 * 这些断言把意图变成可执行检查——如果将来有人在某处重新手写规则，这里会红。
 */

test("策略树每条规则字段完整且 id 唯一", () => {
  const seen = new Set<PolicyRuleId>();
  for (const rule of POLICY_RULES) {
    assert.ok(rule.id, "缺少 id");
    assert.equal(seen.has(rule.id), false, `id 重复：${rule.id}`);
    seen.add(rule.id);
    assert.ok(rule.severity === "block" || rule.severity === "warn", `${rule.id} severity 非法`);
    assert.ok(["ai", "user", "template"].includes(rule.owner), `${rule.id} owner 非法`);
    assert.ok(rule.weight > 0, `${rule.id} 权重必须为正`);
    assert.ok(rule.label.length > 0, `${rule.id} 缺少 label`);
    assert.ok(rule.message.length > 0, `${rule.id} 缺少 message`);
  }
  assert.ok(POLICY_RULES.length >= 7, `规则数不应少于 7，实际 ${POLICY_RULES.length}`);
});

test("提示词文本由策略树派生（每条 promptRule 都必须出现在注入文本里）", () => {
  const text = policyRulesText();
  for (const rule of POLICY_RULES) {
    if (!rule.promptRule) continue;
    assert.ok(text.includes(rule.promptRule), `提示词文本缺少规则 ${rule.id} 的 promptRule`);
  }
  // 不注入的规则（如 fact_gap）不应出现在提示词里
  const noPrompt = POLICY_RULES.filter((rule) => !rule.promptRule);
  for (const rule of noPrompt) {
    assert.equal(text.includes(rule.message), false, `${rule.id} 未声明 promptRule，不应注入提示词`);
  }
});

test("发布门决策由策略树派生（severity=block ⟺ 拦截）", () => {
  for (const rule of POLICY_RULES) {
    const decision = policyDecision({ [rule.id]: 1 });
    if (rule.severity === "block") {
      assert.equal(decision.allowed, false, `${rule.id} 标为 block，应拦截发布`);
      assert.ok(decision.blocking.includes(rule.id), `${rule.id} 应出现在 blocking 列表`);
    } else {
      assert.equal(decision.allowed, true, `${rule.id} 标为 warn，不应拦截发布`);
      assert.ok(decision.warnings.includes(rule.id), `${rule.id} 应出现在 warnings 列表`);
    }
  }
});

test("无命中时放行且无提示", () => {
  const decision = policyDecision({});
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.blocking, []);
  assert.deepEqual(decision.warnings, []);
  assert.equal(decision.message, "");
});

test("被拦时 message 取第一条阻断规则的说明", () => {
  const decision = policyDecision({ fabricated: 1, missing: 2 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.message, policyRule("fabricated").message);
});

test("用户确认事实后，unverified_fact 被豁免（唯一可豁免的阻断项）", () => {
  const before = policyDecision({ unverified_fact: 1 });
  assert.equal(before.allowed, false, "未确认时应拦截");
  const after = policyDecision({ unverified_fact: 1 }, true);
  assert.equal(after.allowed, true, "确认后应放行");
  // 其他阻断项不受 factsConfirmed 影响
  const other = policyDecision({ fabricated: 1 }, true);
  assert.equal(other.allowed, false, "伪造内容不可由确认豁免");
});

test("分数按策略树权重计算", () => {
  assert.equal(qualityScore({}), 100);
  assert.equal(qualityScore({ fabricated: 1 }), 100 - policyRule("fabricated").weight);
  assert.equal(
    qualityScore({ fabricated: 1, missing: 1 }),
    100 - policyRule("fabricated").weight - policyRule("missing").weight,
  );
  // 不会低于 0
  assert.equal(qualityScore({ fabricated: 99 }), 0);
});

test("blockingRuleIds 与策略树的 block 规则一致", () => {
  const fromTree = POLICY_RULES.filter((rule) => rule.severity === "block").map((rule) => rule.id);
  assert.deepEqual(blockingRuleIds(), fromTree);
});

test("事实缺失可发布且标记发布时隐藏（与提示词「宁缺勿假」一致）", () => {
  const factGap = policyRule("fact_gap");
  assert.equal(factGap.severity, "warn", "事实缺失不应阻断发布");
  assert.equal(factGap.owner, "user", "事实缺失的责任方是用户，不是 AI");
  assert.equal(factGap.hideOnPublish, true, "事实缺失应在发布时隐藏");
  // 其余规则都不该标 hideOnPublish（避免误隐藏真实内容）
  for (const rule of POLICY_RULES) {
    if (rule.id === "fact_gap") continue;
    assert.equal(rule.hideOnPublish ?? false, false, `${rule.id} 不应标记 hideOnPublish`);
  }
});
