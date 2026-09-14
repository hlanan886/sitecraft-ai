import type { ProviderResult } from "./ai-provider.ts";
import { splitChatTask, type ChatTask } from "./chat-task-planner.ts";
import type { SiteOperation } from "./site-operations.ts";
import { operationConflictEffects } from "./site-operations.ts";

type ProviderSuccess = Extract<ProviderResult, { ok: true }>;
type ProviderFailure = Extract<ProviderResult, { ok: false }>;

export type ChatTaskPlanResult = ProviderSuccess | ProviderFailure | {
  ok: false;
  code: "operation_conflict" | "too_many_operations" | "split_exhausted" | "timeout";
  error: string;
  model: string | null;
  latencyMs: number;
  attemptCount: number;
};

function failure(code: Extract<ChatTaskPlanResult, { ok: false }>["code"], error: string): ChatTaskPlanResult {
  return { ok: false, code, error, model: null, latencyMs: 0, attemptCount: 0 };
}

export function mergeChatTaskResults(
  results: ProviderResult[],
  options: { maxOperations?: number } = {},
): ChatTaskPlanResult {
  const failed = results.find((result): result is ProviderFailure => !result.ok);
  if (failed) return failed;

  const maxOperations = options.maxOperations ?? 32;
  const operations: SiteOperation[] = [];
  const exact = new Set<string>();
  // 键由 site-operations 的 operationConflictEffects 统一构造（2026-09-12 收口），
  // 本文件不再自己拼字符串——从前两边手拼且已经漂了（见该函数注释）。
  const effects = new Map<string, string>();
  for (const result of results as ProviderSuccess[]) {
    for (const operation of result.operations) {
      const serialized = JSON.stringify(operation);
      if (exact.has(serialized)) continue;
      for (const effect of operationConflictEffects(operation)) {
        const value = JSON.stringify(effect.value);
        const previous = effects.get(effect.key);
        if (previous !== undefined && previous !== value) {
          // 键是内部指纹，不面向用户，所以文案里只说人话，不回显 `item:features:...`。
          return failure("operation_conflict", "多个任务对同一处内容生成了冲突修改");
        }
      }
      exact.add(serialized);
      for (const effect of operationConflictEffects(operation)) effects.set(effect.key, JSON.stringify(effect.value));
      operations.push(operation);
      if (operations.length > maxOperations) {
        return failure("too_many_operations", `聚合操作超过 ${maxOperations} 项`);
      }
    }
  }

  const successes = results as ProviderSuccess[];
  return {
    ok: true,
    summary: [...new Set(successes.map((result) => result.summary).filter(Boolean))].join("；").slice(0, 500),
    operations,
    rejected: [...new Set(successes.flatMap((result) => result.rejected))],
    model: [...new Set(successes.map((result) => result.model))].join(","),
    latencyMs: Math.max(0, ...successes.map((result) => result.latencyMs)),
    attemptCount: successes.reduce((total, result) => total + result.attemptCount, 0),
  };
}

export async function executeChatTaskPlan(args: {
  tasks: ChatTask[];
  deadlineAt: number;
  signal?: AbortSignal;
  runTask: (task: ChatTask) => Promise<ProviderResult>;
  maxConcurrency?: number;
}): Promise<ChatTaskPlanResult> {
  const queue = [...args.tasks];
  const results: ProviderSuccess[] = [];
  const seenRequests = new Set<string>();
  const maxConcurrency = Math.max(1, Math.min(args.maxConcurrency ?? 2, 2));
  let terminalFailure: ChatTaskPlanResult | null = null;
  let attempts = 0;

  const worker = async () => {
    while (!terminalFailure) {
      const item = queue.shift();
      if (!item) return;
      if (args.signal?.aborted || Date.now() >= args.deadlineAt) {
        terminalFailure = failure("timeout", "任务已超过共享截止时间");
        return;
      }
      const requestKey = `${item.scopes.join(",")}|${item.productSkus.join(",")}|${item.selectedTarget ?? ""}|${item.instruction}`;
      if (seenRequests.has(requestKey)) {
        terminalFailure = failure("split_exhausted", "截断任务无法继续缩小且不会原样重试");
        return;
      }
      seenRequests.add(requestKey);
      attempts += 1;
      if (attempts > 36) {
        terminalFailure = failure("split_exhausted", "截断任务拆分次数超过安全上限");
        return;
      }
      let result: ProviderResult;
      try {
        result = await args.runTask(item);
      } catch (error) {
        terminalFailure = failure("provider_error", error instanceof Error ? error.message : "任务执行失败");
        return;
      }
      if (result.ok) {
        results.push(result);
        continue;
      }
      if (result.code !== "output_truncated") {
        terminalFailure = result;
        return;
      }
      const children = splitChatTask(item).filter((child) => {
        const key = `${child.scopes.join(",")}|${child.productSkus.join(",")}|${child.selectedTarget ?? ""}|${child.instruction}`;
        return key !== requestKey && !seenRequests.has(key);
      });
      if (!children.length) {
        terminalFailure = failure("split_exhausted", "模型输出截断，任务已无法继续缩小");
        return;
      }
      queue.push(...children);
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, Math.max(1, queue.length)) }, () => worker()));
  if (terminalFailure) return terminalFailure;
  return mergeChatTaskResults(results);
}
