export const GENERATION_BUDGET = Object.freeze({
  slowNoticeMs: 30_000,
  extendedNoticeMs: 55_000,
  mainStageMs: 60_000,
  recoveryWindowMs: 20_000,
  recoveryTaskMs: 12_000,
  fallbackMinimumMs: 25_000,
  commitReserveMs: 5_000,
  serverDeadlineMs: 115_000,
  clientHardDeadlineMs: 120_000,
});

export function createGenerationDeadlines(startedAt: number) {
  const serverDeadlineAt = startedAt + GENERATION_BUDGET.serverDeadlineMs;
  return {
    slowNoticeAt: startedAt + GENERATION_BUDGET.slowNoticeMs,
    extendedNoticeAt: startedAt + GENERATION_BUDGET.extendedNoticeMs,
    serverDeadlineAt,
    clientDeadlineAt: startedAt + GENERATION_BUDGET.clientHardDeadlineMs,
    workDeadlineAt: serverDeadlineAt - GENERATION_BUDGET.commitReserveMs,
  };
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
