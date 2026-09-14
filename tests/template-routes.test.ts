/**
 * 三个模板路由的测试。
 *
 * ## `pending-jobs`：**真调用**（本轮的可测子集）
 *
 * GET / DELETE 都不碰模型、不开浏览器，唯一副作用是自己那个 jobs 目录——
 * 所以这里跑的是**真响应**：真状态码、真响应体、真缓存头。
 *
 * ## `from-screenshot` / `from-url`：本文件只留**结构契约**
 *
 * ## ✅ 待办已于 2026-09-13 结清（原文保留，见下方"历史登记"）
 *
 * 本文件此前登记过一条待办：这两个 POST 的**非 401 分支没有端到端覆盖**，
 * 因为编排函数是模块级 import，而 `mock.module` 要改 `npm test` 脚本。
 *
 * **现已关闭**：`tests/alias-loader.mjs` 提供了**按需替身**（子路径别名重定向 +
 * `SITECRAFT_TEST_SUBSTITUTIONS`），两个 POST 的错误分支与登记成功路径
 * 都有真实断言了，见同目录：
 *
 * - `template-route-from-url.test.ts`（12 测）
 * - `template-route-from-screenshot.test.ts`（11 测）
 *
 * 本文件因此**只保留结构契约**——那部分仍然有价值（它钉的是"源码里必须长这样"
 * 这类跨文件的形状约束，不是行为），且与真调用**互补**：
 * 行为测试跑在替身上，结构测试读的是**真实源码文本**。
 *
 * ## 历史登记（原文，不再有效）
 *
 * > 这两个 POST 路由的**每一条非 401 分支**都要调真模型或真开浏览器：
 * > `createTemplateFromScreenshot` / `createTemplateFromUrl` 是模块级导入，
 * > 没有 `mock.module`（需 `--experimental-test-module-mocks`，即改 `npm test` 脚本）
 * > 就换不掉。所以它们的 400/409/422/502 分支**本轮没有端到端覆盖**，
 * > 本文件不假装覆盖。
 *
 * ## 为什么能 import 路由了
 *
 * `@/*` 别名 node 原生不认（这正是仓库此前零路由测试的原因）。
 * `tests/alias-loader.mjs` 是**测试内 register**，不改 `npm test` 脚本、不碰 lib/。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";

// ⚠️ 顺序要紧：register 必须在 import 任何路由之前
register("./alias-loader.mjs", import.meta.url);

/**
 * ⚠️ **切 cwd 必须在 import 路由之前**。
 *
 * `lib/pending-job.ts` 的 `JOBS_DIR` 是**模块加载时**按 `process.cwd()` 算出来的常量。
 * 先 import 再 chdir，job 会写进仓库自带的 `.sitecraft-data/`——测试污染真数据目录。
 * 同一个坑 A 轨的 `resolveStorageRoot` 也踩过（模块级常量在加载时冻结）。
 */
const SANDBOX = await mkdtemp(path.join(tmpdir(), "sitecraft-route-contract-"));
process.chdir(SANDBOX);

const { GET, DELETE } = await import("../app/api/templates/pending-jobs/route.ts");
const { startJob, failJob, finishJob, listResumableJobs, STEP_LABELS, jobProgress, JOB_STEPS } = await import(
  "../lib/pending-job.ts"
);

/**
 * 显式声明访问上下文——默认模式是非 development 的 `strict`，缺任一头就是 401。
 * 所以下面每个"正常路径"用例都要带齐三个头；用例③专门证"缺一不可"。
 */
const WORKSPACE = process.env.DEFAULT_WORKSPACE_ID?.trim() || "demo";
const ALLOWED = {
  "x-sitecraft-workspace-id": WORKSPACE,
  "x-sitecraft-actor-id": "route-test",
  "x-sitecraft-role": "editor",
};

/** `JobInput` 要求 `source`（见 `lib/pending-job.ts` 的类型定义）。 */
const URL_INPUT = { source: { kind: "url" as const, url: "https://example.com" } };

function req(method: string, query = "", headers: Record<string, string> = ALLOWED): Request {
  return new Request(`http://localhost/api/templates/pending-jobs${query}`, { method, headers });
}

// ================================================================ pending-jobs · 真调用

test("pending-jobs GET · 缺访问上下文 → 401，且不泄露任何活儿", async () => {
  await startJob("template-from-url", URL_INPUT);

  const response = await GET(req("GET", "", {}));
  assert.equal(response.status, 401);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.error, "access_context_required");
  // 失败响应里不能冒出 jobs 字段——401 就是 401，不许"顺便"给数据
  assert.equal("jobs" in body, false, "401 的响应体不许夹带 jobs");
  // 鉴权失败的响应明确不可缓存（否则代理会把 401 缓存给合法用户）
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("pending-jobs GET · 只列「可行动」的活儿：中间态不出现在恢复列表里", async () => {
  const running = await startJob("template-from-screenshot", { source: { kind: "upload", urlPath: "a.png" } });
  const broken = await startJob("template-from-url", URL_INPUT);
  await failJob(broken.jobId, { message: "这个网址打不开" });
  const halfDone = await startJob("template-from-url", URL_INPUT);
  await finishJob(halfDone.jobId, { templateId: "tpl-x", siteId: null, summary: "做好了但没建站" });

  const response = await GET(req("GET"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { jobs: Array<{ jobId: string }> };
  const ids = body.jobs.map((job) => job.jobId);

  // 中间态（received/reading/…）不列——那说明此刻还有请求在跑，不该打断
  assert.equal(ids.includes(running.jobId), false, "进行中的活儿不该出现在恢复列表");
  // failed 与「done 但没建站」两类要列
  assert.ok(ids.includes(broken.jobId), "失败的活儿必须可恢复");
  assert.ok(ids.includes(halfDone.jobId), "做完了但没建站的活儿必须可恢复");

  // 这是**会变的**状态，不许缓存
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("pending-jobs GET · 每个字段都来自权威源，且前端直接显示不再拼", async () => {
  const job = await startJob("template-from-url", { ...URL_INPUT, suffix: "1712" });
  await failJob(job.jobId, { message: "这个网址打不开" });

  const body = (await (await GET(req("GET"))).json()) as {
    jobs: Array<{
      jobId: string;
      step: string;
      stepLabel: string;
      progress: number;
      description: string;
      input: unknown;
      result: unknown;
    }>;
  };
  const row = body.jobs.find((item) => item.jobId === job.jobId);
  assert.ok(row, "刚失败的那条必须出现在列表里");
  if (!row) return;

  // ⚠️ stepLabel / progress **必须**等于 lib/pending-job 的计算结果。
  // 路由自己再算一遍（或写死文案）就会与后端语义漂移——这里正是防那个的。
  assert.equal(row.step, "failed");
  assert.equal(row.stepLabel, STEP_LABELS.failed);
  assert.equal(row.progress, jobProgress("failed"));
  // 每一步的标签都得是给人看的中文，不是工程术语
  for (const step of [...JOB_STEPS, "failed"] as const) {
    assert.ok(STEP_LABELS[step].length > 0, `${step} 缺标签`);
  }
  // 断点续做靠它：原始输入必须原样带出来（前端回传即可重放）
  assert.deepEqual(row.input, { source: { kind: "url", url: "https://example.com" }, suffix: "1712" });
  assert.equal(row.result, null);
  // 给用户看的一句话——非空，且不出现内部概念
  assert.ok(row.description.length > 0);
  assert.match(row.description, /上次/);
  assert.doesNotMatch(row.description, /job|任务|作业/i, "用户不理解内部概念，文案里不许出现");
});

test("pending-jobs DELETE · 缺 jobId → 400（不是默默成功）", async () => {
  const response = await DELETE(req("DELETE"));
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /jobId/);
});

test("pending-jobs DELETE · 删的是记录，恢复列表里随之消失", async () => {
  const job = await startJob("template-from-url", URL_INPUT);
  await finishJob(job.jobId, { templateId: "tpl-keep-me", siteId: "site-keep-me", summary: "做完了" });

  const response = await DELETE(req("DELETE", `?jobId=${job.jobId}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const left = await listResumableJobs();
  assert.equal(left.some((item) => item.jobId === job.jobId), false, "删过的不该还在恢复列表里");
});

test("pending-jobs DELETE · 删一个不存在的 jobId 不炸（幂等）", async () => {
  // ⚠️ `jobPath` 会净化 id，所以这里用一个**合法字符**的不存在 id（带中文会被净化成空串）
  const response = await DELETE(req("DELETE", "?jobId=no-such-job-0000"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("pending-jobs DELETE · 缺访问上下文 → 401（删活儿也是写操作）", async () => {
  // 先把它变成「可恢复」态，否则它在列表里本来就不出现，测不出"没被删"
  const job = await startJob("template-from-url", URL_INPUT);
  await failJob(job.jobId, { message: "故意失败，让它可恢复" });
  assert.ok(
    (await listResumableJobs()).some((item) => item.jobId === job.jobId),
    "前置条件：这条活儿此刻必须在恢复列表里",
  );

  const response = await DELETE(req("DELETE", `?jobId=${job.jobId}`, {}));
  assert.equal(response.status, 401);

  // 关键：401 之后真的没删——"先检查再动手"不是嘴上说的
  assert.ok(
    (await listResumableJobs()).some((item) => item.jobId === job.jobId),
    "401 之后活儿必须还在（鉴权失败不许产生副作用）",
  );
});

// ================================================================ 两个 POST 路由 · 结构契约（派生自源码）

/** 从源码读 `authorizeRequest(request, "<perm>")` 的权限值——派生，不手抄。 */
function permissionsIn(source: string): string[] {
  return [...source.matchAll(/authorizeRequest\(\s*request\s*,\s*"([a-z:]+)"/g)].map((match) => match[1]);
}

const ROUTES = [
  { file: "../app/api/templates/from-screenshot/route.ts", label: "from-screenshot", permission: "edit" },
  { file: "../app/api/templates/from-url/route.ts", label: "from-url", permission: "edit" },
] as const;

for (const route of ROUTES) {
  const source = await readFile(new URL(route.file, import.meta.url), "utf8");

  test(`${route.label} · 结构：鉴权第一件事，且权限是 ${route.permission}`, () => {
    assert.deepEqual(permissionsIn(source), [route.permission], `必须恰好声明一次 ${route.permission}`);
    // 鉴权必须在**解析请求体之前**——否则未授权的请求也能让服务端解 JSON
    const authAt = source.indexOf("authorizeRequest(");
    const parseAt = source.indexOf("requestSchema.safeParse");
    assert.ok(authAt >= 0 && parseAt > authAt, "先鉴权，再解析请求体");
    assert.match(source, /accessErrorResponse\(/, "必须把拒绝转成响应，不能只判断不返回");
  });

  test(`${route.label} · 结构：转调 /api/templates/runtime，不自己落盘`, () => {
    // 这条是"两条链路走同一扇门"的机制保证——自己落盘就会与质量门/槽位补全漂移
    assert.match(source, /"\/api\/templates\/runtime"/, "登记必须转调现有入口");
    assert.doesNotMatch(source, /writeFile|writeTemplateStatic/, "路由不许自己写盘");
  });

  test(`${route.label} · 结构：断点续做的四步都在`, () => {
    for (const call of ["startJob(", "advanceJob(", "failJob(", "finishJob("]) {
      assert.ok(source.includes(call), `缺 ${call}——断点恢复链路断了`);
    }
  });

  test(`${route.label} · 结构：错误分支必须给中文 message`, () => {
    // 自助场景下没有人兜底，客户只能读这一句话
    const errorBranches = [...source.matchAll(/error:\s*"([a-z_]+)"/g)].map((match) => match[1]);
    assert.ok(errorBranches.length > 0, "必须有具名的错误码，别用裸字符串");
    for (const code of errorBranches) {
      assert.match(code, /^[a-z][a-z_]*$/, `错误码 ${code} 命名不合规`);
    }
    assert.match(source, /message:[^,\n]*[一-龥]/, "错误分支必须给用户一句中文");
  });

  test(`${route.label} · 结构：调用方身份原样转发，不提权`, () => {
    // 转调 runtime 时要带上调用方角色/身份，让 runtime 自己再鉴权一次
    assert.match(source, /x-sitecraft-role/, "必须转发调用方角色");
    assert.match(source, /x-sitecraft-actor-id/, "必须转发调用方身份");
  });
}

test("from-url 结构：搬站必须带 skipQualityGate（机制性的，不是可选项）", async () => {
  // 见 route.ts 顶部说明：搬来的站天然没有集合槽，过不了那道门。
  // 若哪天这句被拿掉，A 的产出会**全部登记失败**——所以钉住它。
  const source = await readFile(new URL("../app/api/templates/from-url/route.ts", import.meta.url), "utf8");
  assert.match(source, /skipQualityGate:\s*true/, "A 路径的登记必须跳槽位门，否则必然失败");
});

test("from-screenshot 结构：跳槽位门的是 A 不是 B（方向不许搞反）", async () => {
  const source = await readFile(new URL("../app/api/templates/from-screenshot/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /skipQualityGate/, "B 的产物有 13–26 个槽位，不该跳门");
});

test("两个路由形状对齐：editable / slots 字段两边都得有（前端同一组件渲染）", async () => {
  // 见 from-screenshot/route.ts:157-161 的说明：前端弹窗用同一个组件渲染结果，
  // 少一个字段就会显示 "undefined"——而 editable 恰恰是用户最该看到的信息。
  for (const route of ROUTES) {
    const source = await readFile(new URL(route.file, import.meta.url), "utf8");
    assert.match(source, /editable/, `${route.label} 必须返回 editable`);
    assert.match(source, /slots:/, `${route.label} 必须返回 slots`);
  }
});
