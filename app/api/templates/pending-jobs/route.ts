import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { dropJob, jobProgress, listResumableJobs, STEP_LABELS, type PendingJob } from "@/lib/pending-job";

export const runtime = "nodejs";

/**
 * 「进行中的活儿」——断点恢复接口。
 *
 * ## 为什么需要它（实测动因，2026-09-11）
 *
 * 客户传了 10 张产品图、传到第 7 张时刷新页面，**前 6 张的去向他一无所知**；
 * 或者截图生成到一半网络断了，回来只看到"生成失败"，不知道是不是白做了。
 *
 * 自助场景下没有人兜底——**用户有疑问不会问我们，他只会关掉页面**。
 * 这个接口让界面能说一句人话："上次做到「拼装版面」这一步，要接着做吗？"
 *
 * ## GET：列出还值得恢复的活儿
 *
 * 只返回**可行动**的两种状态：`failed`（失败了，能重试）与
 * `done` 但**没建成站**（产物做好了却没进工作台）。
 * 中间态（正在跑）不返回——那说明此刻还有请求在处理，不该打断。
 */
export async function GET(request: Request) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;

  const jobs = await listResumableJobs();
  return Response.json(
    {
      jobs: jobs.map((job) => ({
        jobId: job.jobId,
        kind: job.kind,
        step: job.step,
        stepLabel: STEP_LABELS[job.step],
        progress: jobProgress(job.step),
        updatedAt: job.updatedAt,
        /** 给用户看的一句话——**前端直接显示，不要再拼** */
        description: describeForUser(job),
        /** 重放所需的输入（前端原样回传即可） */
        input: job.input,
        result: job.result ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 用户说"不用了"——删掉记录，**不动已经产出的模板与站点**。 */
export async function DELETE(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "缺少 jobId" }, { status: 400 });
  await dropJob(jobId);
  return Response.json({ ok: true });
}

/**
 * 把活儿的状态翻成一句给用户看的话。
 *
 * 措辞原则（与整个产品一致）：**先说发生了什么，再说下一步能做什么**。
 * 不出现"任务""作业""job"这类词——用户不理解我们的内部概念。
 */
function describeForUser(job: PendingJob): string {
  const what = job.kind === "template-from-url" ? "把那个网址搬下来" : "用截图做模板";
  if (job.step === "failed") {
    return `上次${what}没做完：${job.error?.message ?? "中途出错了"}`;
  }
  return `上次${what}已经做好了${job.result?.summary ? `（${job.result.summary}）` : ""}，但还没建站`;
}
