/**
 * 生成预算与超时策略。
 *
 * ## 设计原则（2026-09-08 重构）
 *
 * 原实现用**固定硬截止**（`serverDeadlineMs=115s` 一刀切）——实测 5 个板块组
 * 串行执行时，最后一组必然在 @+110.0s 被砍（5 个 trace 全部如此）。
 *
 * 重构后的三层策略：
 *  1. **进展感知优先**：只要还有批次/分组在持续返回，就不放弃——用 `StallGuard`
 *     检测"连续 N 秒无任何进展"才判定失败，而非按总时长砍。
 *  2. **动态预算**：确需一个上界时，按 `波次 × 单组耗时 × 安全系数` 计算
 *     （`computeGenerationBudgetMs`），而非固定值。
 *  3. **单请求自适应**：单次模型调用用历史 P95 决定超时（`adaptiveTimeoutMs`）。
 *
 * 保留 `deadlineAt` 参数是为了**向后兼容**与"极端兜底"，但它不再是主要判据。
 */

export const GENERATION_BUDGET = Object.freeze({
  /** 慢提示（UX 用，非截止） */
  slowNoticeMs: 30_000,
  /** 延长提示（UX 用，非截止） */
  extendedNoticeMs: 55_000,
  /** @deprecated 单阶段上限保留给局部重生成；全量生成用动态预算 */
  mainStageMs: 60_000,
  recoveryWindowMs: 20_000,
  recoveryTaskMs: 12_000,
  fallbackMinimumMs: 25_000,
  commitReserveMs: 5_000,
  /** 全量生成的**最小**预算（组少时用） */
  serverDeadlineFloorMs: 115_000,
  /** 全量生成的**最大**预算（防止极端情况无限等待） */
  serverDeadlineCeilingMs: 600_000,
  /** 客户端超时**下限**（实际跟随服务端动态预算，避免"服务端还在跑、客户端先断"） */
  clientHardDeadlineMs: 120_000,
  /** 客户端相对服务端预算的宽限（网络/序列化开销） */
  clientGraceMs: 15_000,
  /** 单组请求的经验耗时上界（无历史样本时用） */
  assumedGroupMs: 60_000,
  /** 安全系数：波次 × 单组耗时 × 该系数 */
  budgetSafetyFactor: 1.6,
  /**
   * 板块分组并发数（**单一来源**）。
   *
   * 2026-09-10：此前这里只有预算公式侧写死 `concurrency: 2`，而
   * `lib/site-generator.ts` 的分组并发被 `Math.max(1, MAX_INFLIGHT - 1)` 写死为 **1**，
   * 两处漂移 → 预算低估一半 → **每次生成必然砍掉尾部板块**。
   * 现两处共用本常量，改这里即同时生效。
   */
  groupConcurrency: 2,
  /** 停滞判定：连续多久无任何进展才放弃（替代"总时长硬砍"） */
  stallMs: 90_000,
});

/**
 * 动态计算全量生成的预算上界（替代固定 115s）。
 *
 * 公式：`并发波次 × 单组耗时 × 安全系数 + 提交预留`，夹在 [floor, ceiling]。
 */
export function computeGenerationBudgetMs(args: {
  groupCount: number;
  concurrency: number;
  observedAvgMs?: number;
}): number {
  const waves = Math.max(1, Math.ceil(args.groupCount / Math.max(1, args.concurrency)));
  const perGroup = args.observedAvgMs && args.observedAvgMs > 0
    ? args.observedAvgMs
    : GENERATION_BUDGET.assumedGroupMs;
  const raw = waves * perGroup * GENERATION_BUDGET.budgetSafetyFactor + GENERATION_BUDGET.commitReserveMs;
  return Math.min(
    GENERATION_BUDGET.serverDeadlineCeilingMs,
    Math.max(GENERATION_BUDGET.serverDeadlineFloorMs, Math.round(raw)),
  );
}

export function createGenerationDeadlines(startedAt: number, serverDeadlineMs: number = GENERATION_BUDGET.serverDeadlineFloorMs) {
  const serverDeadlineAt = startedAt + serverDeadlineMs;
  return {
    slowNoticeAt: startedAt + GENERATION_BUDGET.slowNoticeMs,
    extendedNoticeAt: startedAt + GENERATION_BUDGET.extendedNoticeMs,
    serverDeadlineAt,
    clientDeadlineAt: startedAt + Math.max(serverDeadlineMs, GENERATION_BUDGET.clientHardDeadlineMs),
    workDeadlineAt: serverDeadlineAt - GENERATION_BUDGET.commitReserveMs,
  };
}

/**
 * 客户端超时：跟随服务端动态预算 + 宽限，取两者较大值。
 * 修复"服务端允许 600s、客户端 120s 就断"的前后矛盾。
 */
export function clientTimeoutMs(serverBudgetMs: number): number {
  return Math.max(GENERATION_BUDGET.clientHardDeadlineMs, serverBudgetMs + GENERATION_BUDGET.clientGraceMs);
}

export function getRemainingBudget(deadlineAt: number | undefined, now = Date.now()): number {
  return deadlineAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, deadlineAt - now);
}

export function getRemainingStageTimeout(args: {
  deadlineAt?: number;
  stageCapMs: number;
  reserveMs?: number;
  now?: number;
}): number {
  const remaining = getRemainingBudget(args.deadlineAt, args.now) - (args.reserveMs ?? 0);
  return Math.max(0, Math.min(args.stageCapMs, remaining));
}

export function hasFallbackBudget(remainingMs: number): boolean {
  return remainingMs >= GENERATION_BUDGET.fallbackMinimumMs;
}

export function getGenerationWaitNotice(elapsedMs: number): string | null {
  if (elapsedMs >= GENERATION_BUDGET.extendedNoticeMs) {
    return "已进入延长处理，正在隔离慢板块并准备可用初稿。";
  }
  if (elapsedMs >= GENERATION_BUDGET.slowNoticeMs) {
    return "模型响应较慢，仍在生成；已完成的内容会保留。";
  }
  return null;
}

// ===== 进展感知（替代硬截止的核心） =====

export type ProgressGuard = {
  /** 记录一次进展（某批次返回、某板块落地） */
  progress: () => void;
  /** 距上次进展的毫秒数 */
  idleMs: () => number;
  /** 是否已停滞（超过 stallMs 无进展） */
  isStalled: () => boolean;
  /** 是否有过任何进展 */
  hasProgress: () => boolean;
};

/**
 * 创建进展守卫：只要持续有进展就不算失败。
 * 这是替代"固定总时长硬砍"的核心机制。
 */
export function createProgressGuard(
  stallMs: number = GENERATION_BUDGET.stallMs,
  now: () => number = () => Date.now(),
): ProgressGuard {
  let lastProgressAt = now();
  let progressed = false;
  return {
    progress: () => { lastProgressAt = now(); progressed = true; },
    idleMs: () => now() - lastProgressAt,
    isStalled: () => now() - lastProgressAt > stallMs,
    hasProgress: () => progressed,
  };
}
