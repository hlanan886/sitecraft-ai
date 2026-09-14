/**
 * 内容治理策略树 —— **提示词 / 质检器 / 发布门的单一真相源**。
 *
 * 背景（2026-09-08）：三者此前各自实现同一套内容策略，改一处必须同步改另两处，
 * 否则静默失效。「待补充」语义 bug 就是这么来的——提示词教 AI 写"待补充"，
 * 质检器却把它和 lorem ipsum 归为同类扣分，发布门因此拦截。
 *
 * 设计依据：
 * - Policy-as-Prompt（NeurIPS 2025）：同一棵策略树产出①可读文档②提示词文本③运行时拦截器。
 * - Input/Output Guardrails：校验层在模型之外，single chokepoint + 集中审计。
 * - LLM-as-Judge：分数是 advisory，每条判定必须带 rationale。
 *
 * 三条派生规则（同源性测试锁定，见 tests/content-policy.test.ts）：
 *   1. 提示词规则文本 ← `promptRule`
 *   2. 质检器扣分与分类 ← `weight` / `severity`
 *   3. 发布门放行决策 ← `policyDecision()`
 */
import { POLISH_RATIO, SLOT_MAX_LENGTH } from "./template-slot-contract.ts";

export type PolicyRuleId =
  /** 伪造内容：example.com、lorem ipsum —— 比缺失更糟，访客会当真信息 */
  | "fabricated"
  /** 该写没写：空值、模板 demo 残留（AI 的责任） */
  | "missing"
  /** 元说明：把缺口标记写成面向访客的说明句 */
  | "meta_commentary"
  /** 破版：超出模板可读性推荐长度 */
  | "over_limit"
  /** 语言漂移：中文站出现纯英文文案（或反之） */
  | "language_drift"
  /** 事实缺失："待补充"——只有真实企业事实允许，可发布但发布时隐藏 */
  | "fact_gap"
  /** 未确认事实：数字/认证/性能声明，需用户核对 */
  | "unverified_fact";

/** 处置级别：block=拦截发布 / warn=提示但放行 */
export type PolicySeverity = "block" | "warn";
/** 责任方：决定"该谁动手"（AI 重写 / 用户补齐 / 模板适配） */
export type PolicyOwner = "ai" | "user" | "template";

export type PolicyRule = {
  id: PolicyRuleId;
  severity: PolicySeverity;
  owner: PolicyOwner;
  /** 质检扣分权重 */
  weight: number;
  /** 用户可见的中文名（UI 用） */
  label: string;
  /** 发布被拦时给用户看的说明 */
  message: string;
  /** 注入提示词的规则文本（空 = 不注入） */
  promptRule?: string;
  /** 发布时是否隐藏对应字段 */
  hideOnPublish?: boolean;
};

/**
 * 提示词里的「文案多长合适」——从模板容量**派生**，不再写死 15/40。
 *
 * 原先这里硬编码"标题≤15汉字/10词，说明≤40汉字/25词"，而 `checkCopyLength`
 * 拿同一组数字**硬拒写入**、`over_limit` 规则还把它当**发布门**（`severity: "block"`）。
 * 一套数字三个用途、其中两个是拦截——而模板真实容量是 160/800。
 * 结果：模型照 40 写、稍有发挥就被拒，`about.body` 连续 4 次写不进草稿（2026-09-12 真机实测）。
 *
 * 现在提示词只给**写作建议**，取值由容量派生（`POLISH_RATIO`），
 * 容量改了建议自动跟着改。拦截只认容量本身。
 */
export function readabilityHint(): string {
  const title = Math.round(SLOT_MAX_LENGTH["hero.title"] * POLISH_RATIO);
  const body = Math.round(SLOT_MAX_LENGTH["about.body"] * POLISH_RATIO);
  return `文案简短有力：标题约 ${title} 字、说明约 ${body} 字最易读（上限见各槽位 maxLength）`;
}

/**
 * 策略树。**新增内容规则只改这里**——三者自动跟上。
 * weight 之和不必为 100；分数由 `qualityScore` 归一。
 */
export const POLICY_RULES: readonly PolicyRule[] = Object.freeze([
  {
    id: "fabricated",
    severity: "block",
    owner: "ai",
    weight: 12,
    label: "伪造内容",
    message: "草稿含示例/伪造内容（如 example.com、lorem ipsum），请替换为真实信息后再发布。",
    promptRule: "禁止使用 example.com/lorem ipsum 等示例或占位内容冒充真实信息；没有真实数据就留缺口标记，不要编造。",
  },
  {
    id: "missing",
    severity: "block",
    owner: "ai",
    weight: 12,
    label: "内容缺失",
    message: "草稿仍有板块内容缺失，请补全后再发布。",
    promptRule: "每个列出的板块都必须产出内容，不得留空或沿用模板 demo 文案。",
  },
  {
    id: "meta_commentary",
    severity: "block",
    owner: "ai",
    weight: 10,
    label: "说明性语句",
    message: "草稿含\"待补充\"之类的说明性语句（面向访客的文案不该出现），请让 AI 重写后再发布。",
    promptRule: "\"待补充\"是给站主看的缺口标记，不是文案：禁止把它当作句子成分写进正文，禁止写\"我们将…标记为待补充\"这类说明性语句。",
  },
  {
    id: "over_limit",
    severity: "block",
    owner: "ai",
    weight: 8,
    label: "文案超长",
    message: "草稿有文案超出模板容量，请精简后再发布。",
    promptRule: readabilityHint(),
  },
  {
    id: "language_drift",
    severity: "block",
    owner: "ai",
    weight: 6,
    label: "语言漂移",
    message: "草稿存在中英混排或语言漂移，请统一为站点语言后再发布。",
    promptRule: "站点内容保持当前语言（中文站用中文，英文站用英文），除非用户明确要求切换语言。",
  },
  {
    id: "unverified_fact",
    severity: "block",
    owner: "user",
    weight: 10,
    label: "待确认事实",
    message: "草稿包含待确认的数字/认证/性能等声明，请先人工核对后确认发布。",
    promptRule: "不得虚构客户、认证、产能、价格或经营数据；引用数字/认证必须来自用户提供的事实。",
  },
  {
    id: "fact_gap",
    severity: "warn",
    owner: "user",
    weight: 6,
    label: "待补充事实",
    message: "部分企业事实（电话/邮箱/地址等）尚未提供，发布时这些字段将隐藏。",
    promptRule: "缺失的企业事实（地址、电话、邮箱、认证、产能、年限等）只能写成\"待补充\"这一类简短的缺口标记本身；绝不虚构。",
    hideOnPublish: true,
  },
]);

const RULES_BY_ID = new Map<PolicyRuleId, PolicyRule>(POLICY_RULES.map((rule) => [rule.id, rule]));

export function policyRule(id: PolicyRuleId): PolicyRule {
  const rule = RULES_BY_ID.get(id);
  if (!rule) throw new Error(`未知策略规则：${id}`);
  return rule;
}

/** 阻断发布（severity=block）的规则 id */
export function blockingRuleIds(): PolicyRuleId[] {
  return POLICY_RULES.filter((rule) => rule.severity === "block").map((rule) => rule.id);
}

/** 提示词规则段：由策略树派生，提示词不再手写这些规则 */
export function policyRulesText(): string {
  return POLICY_RULES
    .filter((rule) => rule.promptRule)
    .map((rule) => `- ${rule.promptRule}`)
    .join("\n");
}

/** 按规则 id 统计各报告项的命中数（发布门与分数共用同一口径） */
export type PolicyCounts = Partial<Record<PolicyRuleId, number>>;

export function qualityScore(counts: PolicyCounts): number {
  let deduction = 0;
  for (const rule of POLICY_RULES) {
    const count = counts[rule.id] ?? 0;
    deduction += count * rule.weight;
  }
  return Math.max(0, Math.min(100, 100 - deduction));
}

export type PolicyDecision = {
  allowed: boolean;
  /** 拦截发布的规则（按策略树顺序） */
  blocking: PolicyRuleId[];
  /** 仅提示不拦截的规则 */
  warnings: PolicyRuleId[];
  /** 被拦时给用户看的主说明（取第一条阻断规则） */
  message: string;
};

/**
 * 发布门决策：**发布门不再自己列字段**，只问这里。
 * @param counts 各规则的命中数
 * @param factsConfirmed 用户是否已显式确认事实属实（仅对 unverified_fact 生效）
 */
export function policyDecision(counts: PolicyCounts, factsConfirmed = false): PolicyDecision {
  const blocking: PolicyRuleId[] = [];
  const warnings: PolicyRuleId[] = [];
  for (const rule of POLICY_RULES) {
    const count = counts[rule.id] ?? 0;
    if (count === 0) continue;
    // 用户确认后，未确认事实类放行（唯一可由用户豁免的阻断项）
    if (rule.id === "unverified_fact" && factsConfirmed) continue;
    if (rule.severity === "block") blocking.push(rule.id);
    else warnings.push(rule.id);
  }
  return {
    allowed: blocking.length === 0,
    blocking,
    warnings,
    message: blocking.length ? policyRule(blocking[0]).message : "",
  };
}
