/**
 * 模型自评（做轻 ①）
 *
 * 在硬规则 conformance（G1 语言/G4 破坏性/模板切换）之外，补一层软质量自评：
 * 仅当改动较大时（≥3 个操作或含破坏性操作）触发，多调一次 DeepSeek 检查：
 * - scope：是否只改了用户要求的对象
 * - locale：语言与用户限定是否一致
 * - copy：文案是否过短/过长/空泛/堆砌形容词
 * - hallucination：是否虚构客户/认证/产能/数据
 *
 * 遵循 reflection 模式三约束：
 * 1. 固定 criteria（枚举 code，禁止模型自由发挥）
 * 2. 最多 1 次重生成（防自嗨，由调用方控制）
 * 3. 确定性 conformance 是硬规则，自评只补软质量（fail-open 不阻断提交）
 */

import { z } from "zod";
import { isDestructiveOperation, type SiteOperation } from "./site-operations.ts";

export const MIN_SELF_EVAL_OPERATIONS = 3;

const selfEvalIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.enum(["scope", "locale", "copy", "hallucination", "other"]),
  message: z.string().min(1).max(300),
});
export const selfEvaluationSchema = z.object({
  ok: z.boolean(),
  issues: z.array(selfEvalIssueSchema).max(8),
});
export type SelfEvalIssue = z.infer<typeof selfEvalIssueSchema>;
export type SelfEvaluation = z.infer<typeof selfEvaluationSchema>;

export type SelfEvalResult = {
  ok: boolean;
  issues: SelfEvalIssue[];
  model: string | null;
  latencyMs: number;
};

export type SelfEvalArgs = {
  message: string;
  summary: string;
  operations: SiteOperation[];
  selectedTarget?: string | null;
  contextBlock?: string;
  templateId: string;
};

/**
 * 是否触发自评：≥3 个操作，或含破坏性操作（删除/隐藏/换模板/重排）。
 */
export function shouldSelfEvaluate(operations: readonly SiteOperation[]): boolean {
  return operations.length >= MIN_SELF_EVAL_OPERATIONS || operations.some(isDestructiveOperation);
}

function evalProviderConfig() {
  return {
    baseURL: (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY,
    model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL,
  };
}

function stripFences(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/** 解析模型自评输出；失败返回 null（fail-open 由调用方决定） */
export function parseSelfEvaluation(content: unknown): { data: SelfEvaluation | null; error: string } {
  if (typeof content !== "string") return { data: null, error: "message.content 不是字符串" };
  try {
    const parsed = selfEvaluationSchema.safeParse(JSON.parse(stripFences(content)));
    if (parsed.success) return { data: parsed.data, error: "" };
    const issues = parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
    return { data: null, error: issues.join("；") };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "JSON 解析失败" };
  }
}

/**
 * 执行自评调用。任何失败（网络/超时/解析）都 fail-open 返回 ok:true，绝不因自评阻断合法改动。
 */
export async function evaluateOperations(args: SelfEvalArgs): Promise<SelfEvalResult> {
  const startedAt = Date.now();
  const { baseURL, apiKey, model } = evalProviderConfig();
  if (!apiKey || !model) {
    return { ok: true, issues: [], model: null, latencyMs: 0 };
  }
  const opsJson = JSON.stringify(args.operations);
  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `你是企业独立站编辑器操作的质检员。只返回 JSON，不输出其他内容。\n请对照用户指令检查 AI 生成的结构化操作，按固定标准判断：\n1. scope：操作是否只修改了用户要求的对象？\n2. locale：操作的语言（zh/en）是否与用户限定一致？\n3. copy：文案是否过短、过长、空泛或堆砌形容词？\n4. hallucination：是否虚构了客户、认证、产能、价格或数据？\n输出格式：{"ok":true|false,"issues":[{"severity":"error|warning","code":"scope|locale|copy|hallucination|other","message":"具体问题"}]}。\n仅当存在必须修正的问题时 ok=false；小瑕疵用 warning 不用 error。`,
          },
          {
            role: "user",
            content: `用户指令：${args.message}\n${args.selectedTarget ? `点击目标：${args.selectedTarget}\n` : ""}${args.contextBlock ? `上下文：${args.contextBlock.slice(0, 800)}\n` : ""}模型摘要：${args.summary}\n生成的操作：${opsJson}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: true, issues: [], model, latencyMs: Date.now() - startedAt };
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const parsed = parseSelfEvaluation(payload.choices?.[0]?.message?.content);
    if (!parsed.data) {
      // 解析失败 fail-open
      return { ok: true, issues: [], model, latencyMs: Date.now() - startedAt };
    }
    return { ok: parsed.data.ok, issues: parsed.data.issues, model, latencyMs: Date.now() - startedAt };
  } catch {
    // 超时/网络失败 fail-open
    return { ok: true, issues: [], model, latencyMs: Date.now() - startedAt };
  }
}

/** 只挑 error 级 issues 拼成反馈文本（≤800 字符），供重生成使用 */
export function selectRetryIssues(issues: SelfEvalIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error").map((i) => `[${i.code}] ${i.message}`);
  return errors.join("；").slice(0, 800);
}
