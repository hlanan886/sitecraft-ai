/**
 * 替身基建的共用件：替身脚本夹具 + 沙箱目录观察。
 *
 * ⚠️ **每个替身测试文件只许 import 一次 `setupSubstitutedRoute`**——
 * 因为 `lib/pending-job.ts` 的 `JOBS_DIR` 是**模块加载时**按 cwd 算的常量，
 * 同一进程里第二次 `setupSubstitutedRoute` 换沙箱时它**不会重算**，
 * 于是第二个路由的 job 会写进第一个沙箱，而 `jobCount(第二个沙箱)` 恒为 0
 * ——那正是本项目反复吃亏的「假门禁」。`node --test` 每个文件独立进程，
 * 所以"一个文件 = 一条路由"是天然的正确切分。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { CreateFromUrlResult } from "../../lib/template-from-url.ts";

/**
 * A 轨（网址搬站）的产物夹具。
 *
 * ⚠️ 形状必须与 `lib/template-from-url.ts` 的 `StaticTemplateBundle` 一致：
 * 少一个字段就会在**真实下游**（`postProcessPrecipitatedTemplateHtml` /
 * `collectSlotTargetsFromHtmlString` / `toRegisterAssets`）里炸——
 * 那些函数是真跑的，这正是本测试的价值所在。
 */
export function urlBundle(overrides: Partial<Record<string, unknown>> = {}) {
  const html = (overrides.html as string) ?? "<html><body><h1>某某机械制造有限公司</h1></body></html>";
  return {
    templateId: "substitution-probe-a1",
    name: "替身探针站点",
    category: "制造业",
    description: "替身测试用",
    html,
    assets: {},
    binaryAssets: {},
    initialDraft: null,
    summary: "本地化 0 个资源",
    warnings: [],
    library: [],
    stats: { captureMs: 1, downloadMs: 0, totalMs: 1, resourceCount: 0, totalBytes: 0, rewritten: 0 },
    ...overrides,
  };
}

/** 与 `urlBundle` 配套的 capture（A 轨的成功返回要它）。 */
export function urlCapture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    url: "https://probe.example.com/",
    title: "替身探针站点",
    html: urlBundle().html,
    assets: [],
    shot: null,
    failure: null,
    elapsedMs: 1,
    library: [],
    ...overrides,
  };
}

/** 造一个"抓取失败"的结果——路由据此判 **502**。 */
export const CAPTURE_FAILED: CreateFromUrlResult = { ok: false, step: "capture", message: "这个网址打不开，换个地址试试。" };
/** 造一个"整理失败"的结果——用户能自修，路由据此判 **422**。 */
export const EXPORT_FAILED: CreateFromUrlResult = { ok: false, step: "export", message: "整理这个页面时出错了。" };

/** 数沙箱里的 job 记录——用来断言"这条分支没产生副作用"。 */
export async function jobCount(sandbox: string): Promise<number> {
  try {
    return (await readdir(path.join(sandbox, ".sitecraft-data", "pending-jobs"))).length;
  } catch {
    return 0;
  }
}
