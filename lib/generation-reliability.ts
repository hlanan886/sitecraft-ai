/**
 * 生成可靠性：自适应超时 + 分而治之 + 流式增量提交。
 *
 * 背景（2026-09-08 实测数据）：
 *  - deepseek-v4-flash 单批大输出仅 1086 token / 7.3s（内容偷懒，ops=2）
 *  - deepseek-v4-pro 单批 5019 token / 70.8s（内容完整，ops=31）
 *  - 原 `mainStageMs=60s` 固定硬截止 → 必然超时 → 丢弃已生成内容 → partial 率 100%
 *
 * 因此不再用"固定总时长赌成功率"，改为：
 *  1. **分而治之**：把 5 板块拆成多个小请求，单请求输出少 → 快且不截断；
 *  2. **自适应超时**：按该任务的历史 P95 动态给时限（带上下限），慢任务自动降级；
 *  3. **增量提交**：每个板块一返回就写入草稿（由调用方提交），不等全批完成；
 *  4. **无全局硬截止**：只有"停滞检测"（长时间无任何进展才放弃），而非一刀切时间。
 */

export type AdaptiveTimeoutConfig = {
  /** 该任务类型的初始超时（无历史时使用） */
  initialMs: number;
  /** 自适应下限：再快也不能低于此（防止抖动导致误杀） */
  floorMs: number;
  /** 自适应上限 */
  ceilingMs: number;
  /** 停滞判定：连续多久无任何输出即放弃（比"总时长"更符合真实失败语义） */
  stallMs: number;
};

export const ADAPTIVE_DEFAULTS: AdaptiveTimeoutConfig = {
  initialMs: 90_000,
  floorMs: 30_000,
  ceilingMs: 180_000,
  stallMs: 45_000,
};

/** 单次观测（用于滚动 P95） */
export type LatencySample = { taskKey: string; latencyMs: number; ok: boolean };

const samples = new Map<string, number[]>();
const MAX_SAMPLES = 20;

export function recordLatency(sample: LatencySample): void {
  if (!sample.ok) return; // 只统计成功样本，失败（超时）不污染基线
  const list = samples.get(sample.taskKey) ?? [];
  list.push(sample.latencyMs);
  if (list.length > MAX_SAMPLES) list.shift();
  samples.set(sample.taskKey, list);
}

/** 取该任务的历史 P95；样本不足时返回 undefined */
export function percentile95(taskKey: string): number | undefined {
  const list = samples.get(taskKey);
  if (!list || list.length < 3) return undefined;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

/** 该组 key 的样本均值；样本不足时返回 undefined（调用方回退假设值）。 */
export function averageLatency(taskKey: string): number | undefined {
  const list = samples.get(taskKey);
  if (!list || list.length < 3) return undefined;
  return Math.round(list.reduce((sum, value) => sum + value, 0) / list.length);
}

/**
 * 一组分组的平均耗时（取各组成熟样本的均值；任一组成熟即用）。
 *
 * 2026-09-10：接到 `computeGenerationBudgetMs` 的 `observedAvgMs`——
 * 该参数此前**无任何调用点**，导致预算永远基于 `assumedGroupMs`(60s) 的假设值，
 * 慢模型下低估、快模型下高估。分组 key 格式与 `site-generator.ts` 的
 * `${templateId}:group:${sections.join("+")}` 必须一致，故由调用方传入已分组。
 */
export function averageGroupLatency(groups: readonly SectionGroup[], templateId: string): number | undefined {
  const observed = groups
    .map((group) => averageLatency(`${templateId}:group:${group.sections.join("+")}`))
    .filter((value): value is number => typeof value === "number");
  if (!observed.length) return undefined;
  return Math.round(observed.reduce((sum, value) => sum + value, 0) / observed.length);
}

/**
 * 自适应超时：有历史则按 P95 × 1.5（留余量），无历史用 initial；
 * 结果夹在 [floor, ceiling] 之间，避免极端值。
 */
export function adaptiveTimeoutMs(taskKey: string, config: AdaptiveTimeoutConfig = ADAPTIVE_DEFAULTS): number {
  const p95 = percentile95(taskKey);
  const base = p95 ? Math.round(p95 * 1.5) : config.initialMs;
  return Math.min(config.ceilingMs, Math.max(config.floorMs, base));
}

/** 测试用：清空样本 */
export function resetLatencySamples(): void {
  samples.clear();
}

// ===== 分而治之：板块分组 =====

export type SectionGroup = {
  /** 组内板块 */
  sections: string[];
  /** 该组的预估输出量（用于选择批次大小） */
  weight: number;
};

/**
 * 把板块拆成小批次：每批 1-2 个板块（内容型板块单独成批，元数据类可合并）。
 * 目的：单请求输出少 → 快、不截断、可增量提交。
 */
export function planSectionGroups(sections: string[], maxPerGroup = 2): SectionGroup[] {
  const heavy = new Set(["features", "services", "products"]); // 条目型，输出量大
  const groups: SectionGroup[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) {
      groups.push({ sections: [...buffer], weight: buffer.reduce((s, x) => s + (heavy.has(x) ? 3 : 1), 0) });
      buffer = [];
    }
  };
  for (const section of sections) {
    // 重板块单独成批
    if (heavy.has(section)) {
      flush();
      groups.push({ sections: [section], weight: 3 });
      continue;
    }
    buffer.push(section);
    if (buffer.length >= maxPerGroup) flush();
  }
  flush();
  return groups;
}

// ===== 停滞检测（替代固定总截止）=====
//
// **2026-09-10 去重**：此处原有一个与 `lib/generation-budget.ts` 的 `createProgressGuard`
// **完全重复**的实现（`createStallGuard`）。两者都在同一时间点被建、都被测试喂、都无人调用，
// 且常量也重复（`ADAPTIVE_DEFAULTS.stallMs` 45s vs `GENERATION_BUDGET.stallMs` 90s——
// 同一种语义两个值，接哪个都会让另一个成为陷阱）。
// 现统一到 `createProgressGuard`（它在 `generation-budget.ts` 里，且功能更全：多 `hasProgress()`），
// 本文件只保留一个**转发别名**，既有 import 与测试无需改动。
export { createProgressGuard as createStallGuard } from "./generation-budget.ts";
export type { ProgressGuard as StallGuard } from "./generation-budget.ts";
