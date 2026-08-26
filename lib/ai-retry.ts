/**
 * 有限重试执行器：把"尝试一次模型调用"抽象为可注入的 task，
 * 让超时/网络错误/schema 失败都能在 2 次尝试内重试，且可被单测覆盖。
 *
 * 设计约束（Codex 验收反馈 D2）：
 * - 总尝试次数最多 2 次
 * - 超时后允许重试（continue 而非 break）
 * - 429/5xx 保留有限重试；4xx 参数/认证错误不重试
 * - 重试不修改草稿（提交仍由调用方走 revision 乐观锁）
 * - 返回实际尝试次数，便于可观测
 */

export type RetryTaskResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "timeout" | "provider_error" | "invalid_output" | "rate_limited" | "client_error"; error: string };

export type RetryOutcome<T> = {
  result: RetryTaskResult<T>;
  attemptCount: number;
};

const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 500;

/**
 * 执行 task（一次模型调用），在以下情况重试：
 * - task 返回 timeout / provider_error / rate_limited（5xx/429 类）
 * - task 抛出超时/网络异常
 * client_error（4xx）与 invalid_output（schema 失败，调用方自行决定反馈重试）不在此重试。
 */
export async function withLimitedRetry<T>(
  task: () => Promise<RetryTaskResult<T>>,
  options: { isTimeoutError?: (error: unknown) => boolean } = {},
): Promise<RetryOutcome<T>> {
  const { isTimeoutError = (e) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") } = options;
  let last: RetryTaskResult<T> = { ok: false, code: "provider_error", error: "未知错误" };
  let attemptCount = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    attemptCount += 1;
    try {
      last = await task();
      if (last.ok) return { result: last, attemptCount };
      // 可重试的失败类型：超时/网络/限流/5xx
      if (last.code === "client_error" || last.code === "invalid_output") {
        return { result: last, attemptCount };
      }
      // 还有重试机会则退避后继续
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_MS);
      }
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const message = error instanceof Error ? error.message : "网络错误";
      last = timedOut
        ? { ok: false, code: "timeout", error: "DeepSeek 请求超时" }
        : { ok: false, code: "provider_error", error: `无法连接 DeepSeek：${message}` };
      // 超时/网络错误也允许重试（外层 2 次尝试内）
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }
  return { result: last, attemptCount };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
