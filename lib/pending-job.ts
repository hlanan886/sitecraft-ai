/**
 * 「进行中的活儿」——断点恢复的落点（2026-09-11）。
 *
 * ## 为什么单独一个模块，不复用 `generation-record.ts`
 *
 * 那个是**审计存证**：落 PG、只在生产开启、字段是给质量回溯看的
 * （prompt 指纹、模型、耗时），而且**开发环境退化为无操作**。
 * 拿它做用户恢复，本地根本存不下来，字段也对不上。
 *
 * 这里要的东西完全不同：
 *
 * | | 审计存证 | 本模块 |
 * |---|---|---|
 * | 目的 | 事后追查"这条内容是谁生成的" | 事前告诉用户"你上次做到哪了" |
 * | 生命周期 | 长期保留 | **完成即删** |
 * | 存在哪 | PG | 本地文件（与站点草稿同一套本地存储） |
 * | 字段 | 模型/指纹/耗时 | **重放所需的输入** + 当前步骤 |
 *
 * ## 真实场景（不是假想）
 *
 * 客户传了 10 张产品图、传到第 7 张时刷新页面，**前 6 张的去向他一无所知**。
 * 或者：截图生成到一半网络断了，回来只看到"生成失败"，不知道是不是白做了。
 *
 * 有了这个记录，回到页面时能说：**"上次做到「拼装版面」这一步，要接着做吗？"**
 *
 * ## 只记能重放的最小输入
 *
 * `input` 里放的是**足以原样重跑一次**的东西（截图路径 / 网址 / 补充说明），
 * 不是过程中间的产物。这样"恢复"就是把输入再喂一遍——产出物由同一套代码决定，
 * 结果与没断过一样。**存中间态反而会让恢复路径与正常路径分叉**，那才是 bug 的温床。
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const JOBS_DIR = path.join(process.cwd(), ".sitecraft-data", "pending-jobs");

/** 生成流程的步骤。**顺序即进度**，前端直接按它点亮。 */
export const JOB_STEPS = [
  "received",
  "reading",
  "composing",
  "registering",
  "creating-site",
  "done",
] as const;
export type JobStep = (typeof JOB_STEPS)[number] | "failed";

/** 每步给用户看的话——**别用工程术语**。 */
export const STEP_LABELS: Record<JobStep, string> = {
  received: "已收到",
  reading: "正在看清这张图/这个页面",
  composing: "正在拼装版面",
  registering: "正在存进模板库",
  "creating-site": "正在建站",
  done: "已完成",
  failed: "中止了",
};

export type JobInput = {
  source: { kind: "upload"; urlPath: string } | { kind: "url"; url: string };
  note?: string;
  suffix?: string;
};

export type PendingJob = {
  jobId: string;
  kind: "template-from-screenshot" | "template-from-url";
  step: JobStep;
  input: JobInput;
  startedAt: string;
  updatedAt: string;
  /** 完成后填，供"去编辑这个站"用 */
  result?: { templateId: string; siteId: string | null; summary: string };
  /** 失败时填——**说人话**，直接给用户看 */
  error?: { message: string; detail?: string };
};

/** 超过这个时长的活儿不再提示恢复——用户多半已经忘了自己在干什么。 */
const STALE_MS = 1000 * 60 * 60 * 6;

function jobPath(jobId: string): string {
  // jobId 由本模块生成（UUID），但仍做一次净化——防的是"未来某天有人从
  // 请求里传 jobId 进来"这种改动，那时的路径穿越就在这里挡住。
  const safe = jobId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  return path.join(JOBS_DIR, `${safe}.json`);
}

async function writeJob(job: PendingJob): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  await writeFile(jobPath(job.jobId), JSON.stringify(job, null, 2), "utf8");
}

/** 开一个活儿。返回的 `jobId` 由调用方一路带着。 */
export async function startJob(kind: PendingJob["kind"], input: JobInput): Promise<PendingJob> {
  const now = new Date().toISOString();
  const job: PendingJob = { jobId: randomUUID(), kind, step: "received", input, startedAt: now, updatedAt: now };
  await writeJob(job);
  return job;
}

/**
 * 推进到下一步。
 *
 * **永不抛异常**——记录进度失败不该让生成本身失败。
 * 一个丢掉的恢复点，远没有"生成到一半崩了"严重。
 */
export async function advanceJob(jobId: string, step: JobStep): Promise<void> {
  try {
    const job = await readJob(jobId);
    if (!job) return;
    job.step = step;
    job.updatedAt = new Date().toISOString();
    await writeJob(job);
  } catch {
    // 记不上就算了
  }
}

/** 标记完成并带上结果（**不删除**——用户可能想回看，由清理逻辑按时间收）。 */
export async function finishJob(jobId: string, result: PendingJob["result"]): Promise<void> {
  try {
    const job = await readJob(jobId);
    if (!job) return;
    job.step = "done";
    job.result = result;
    job.updatedAt = new Date().toISOString();
    await writeJob(job);
  } catch {
    // 同上
  }
}

/** 标记失败并带上**人话**原因。 */
export async function failJob(jobId: string, error: { message: string; detail?: string }): Promise<void> {
  try {
    const job = await readJob(jobId);
    if (!job) return;
    job.step = "failed";
    job.error = error;
    job.updatedAt = new Date().toISOString();
    await writeJob(job);
  } catch {
    // 同上
  }
}

export async function readJob(jobId: string): Promise<PendingJob | null> {
  try {
    const raw = await readFile(jobPath(jobId), "utf8");
    const parsed = JSON.parse(raw) as PendingJob;
    return typeof parsed?.jobId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 列出**还值得恢复**的活儿。
 *
 * 两类：
 *  - `failed`：失败了，可以重试（这是恢复的主要场景——网络断了、图太大）；
 *  - `done` 但**还没建站**：产物做好了却没进工作台，用户多半是没看到结果就走了。
 *
 * **中间态（received/reading/…）不算**——那说明此刻还有请求在跑，
 * 或者进程崩了。前者不该打断，后者重放一次就好（幂等由 suffix 保证）。
 *
 * 超过 `STALE_MS` 的一律不列，并顺手删掉。
 */
export async function listResumableJobs(): Promise<PendingJob[]> {
  const files = await readdir(JOBS_DIR).catch(() => [] as string[]);
  const now = Date.now();
  const out: PendingJob[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const job = await readJob(fileName.replace(/\.json$/, ""));
    if (!job) continue;
    const age = now - new Date(job.updatedAt).getTime();
    if (age > STALE_MS) {
      await unlink(jobPath(job.jobId)).catch(() => {});
      continue;
    }
    if (job.step === "failed" || job.step === "done") out.push(job);
  }
  return out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** 删掉一个活儿（用户说"不用了"）。 */
export async function dropJob(jobId: string): Promise<void> {
  await unlink(jobPath(jobId)).catch(() => {});
}

/** 给用户看的一句话：这个活儿进行到哪了。 */
export function describeJob(job: PendingJob): string {
  const what = job.kind === "template-from-url" ? "搬一个网址" : "用截图做模板";
  if (job.step === "done") {
    return `上次${what}已经做好了${job.result?.summary ? `（${job.result.summary}）` : ""}`;
  }
  if (job.step === "failed") {
    return `上次${what}中止在「${STEP_LABELS[job.step]}」之前${job.error?.message ? `：${job.error.message}` : ""}`;
  }
  return `上次${what}进行到「${STEP_LABELS[job.step]}」`;
}

/** 进度百分比（前端画进度条用）。`failed` 不参与——它不是进度。 */
export function jobProgress(step: JobStep): number {
  if (step === "failed") return 0;
  const index = JOB_STEPS.indexOf(step as (typeof JOB_STEPS)[number]);
  if (index < 0) return 0;
  return Math.round(((index + 1) / JOB_STEPS.length) * 100);
}
