/**
 * `from-url` 路由的**错误分支端到端真测**（队列 B2 / 阶段 0.4）。
 *
 * ## 补的是什么缺口
 *
 * `tests/template-routes.test.ts` 对这条 POST **只做结构契约**——因为它的每条
 * 非 401 分支都要真开浏览器抓站。现在 `tests/alias-loader.mjs` 提供**按需替身**，
 * 把 `@/lib/template-from-url` 换成同形状替身，于是**鉴权、zod、job 记账、
 * 转调登记、建站**全部真跑，只有"开浏览器抓站"这一步是假的。
 *
 * ## 状态码口径（两个路由必须一致，所以两边都钉）
 *
 * | 原因 | 谁的责任 | 状态码 |
 * |---|---|---|
 * | 请求体不合法 | 调用方 | 400 |
 * | 没带访问上下文（strict） | 调用方 | 401 |
 * | 抓取/截图失败 | **外部**，用户改不了 | 502 |
 * | 读图/整理失败 | 用户能自修 | 422 |
 * | 登记撞名 | 可重试 | 409 |
 * | 登记被质量门等拒 | 产物问题 | 422 |
 *
 * ⚠️ **本文件只 import 一次 `setupSubstitutedRoute`**：`lib/pending-job.ts` 的
 * `JOBS_DIR` 是模块加载时按 cwd 冻结的常量，同进程换沙箱它不会重算——
 * 第二个沙箱里的计数就会恒为 0（假门禁）。`node --test` 每文件独立进程，
 * 所以"一文件一路由"是正确切分。同族的 `from-screenshot` 另见同名文件。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { templates } from "../lib/site-model.ts";
import { armSubstitutions, fakeOr } from "../lib/testing/substitution.ts";
import { serveRoute, setupSubstitutedRoute } from "./helpers/substitution.ts";
import { CAPTURE_FAILED, EXPORT_FAILED, jobCount, urlBundle, urlCapture } from "./helpers/fixtures-from-url.ts";

/**
 * ⚠️ **探针路径必须在 `register()` 之前设好**——loader 是在**模块加载时**读这个
 * 环境变量的（见 `tests/alias-loader.mjs`）。它的作用是把"解析钩子到底把哪些
 * 别名指向了替身"落盘，供下面的负向验证取证：钩子跑在独立线程里，从测试进程
 * 读不到它的状态，没有这个出口就只能靠猜。
 */
const PROBE_PATH = path.join(tmpdir(), `sitecraft-loader-probe-${process.pid}.txt`);
process.env.SITECRAFT_TEST_SUBSTITUTION_PROBE = PROBE_PATH;

const ctx = await setupSubstitutedRoute(
  { "@/lib/template-from-url": { createTemplateFromUrl: EXPORT_FAILED } },
  new URL("../app/api/templates/from-url/route.ts", import.meta.url).href,
);
/** 转调目标：本进程里的**真实** runtime 路由，挂在真端口上（转调本来就是 HTTP）。 */
const runtime = await import(new URL("../app/api/templates/runtime/route.ts", import.meta.url).href);
const server = await serveRoute("POST", async (request) => {
  const response = await runtime.POST(request);
  console.log("ROUTE-SAW-INCOMING", JSON.stringify({
    all: [...request.headers.keys()],
  }));
  console.log("FANOUT", JSON.stringify({
    ws: request.headers.get("x-sitecraft-workspace-id"),
    actor: request.headers.get("x-sitecraft-actor-id"),
    role: request.headers.get("x-sitecraft-role"),
    status: response.status,
  }));
  return response;
});
test.after(async () => {
  await server.close();
  await ctx.teardown();
});

/** 换掉替身返回值——替身是**每次调用时**读表的，所以用例之间可以各给各的。 */
const stubUrlOrchestrator = (result: unknown) =>
  armSubstitutions({ "@/lib/template-from-url": { createTemplateFromUrl: result } });

test("400：请求体不合法 → 拦在编排层之前（连 job 都没记）", async () => {
  stubUrlOrchestrator(CAPTURE_FAILED);
  const before = await jobCount(ctx.sandbox);

  const response = await ctx.post("/api/templates/from-url", { url: "这不是网址" }, { baseUrl: server.baseUrl });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string; details: { fieldErrors: Record<string, string[]> } };
  assert.equal(body.error, "Invalid request");
  assert.ok(body.details.fieldErrors.url, "错误要指到具体字段，不能只说'非法'");

  // 真正的证据：**副作用一个都没发生**。若哪天校验被挪到记账之后，这条会红。
  assert.equal(await jobCount(ctx.sandbox), before, "400 不该产生任何 job");
});

test("400：body 不是 JSON 也不炸（`.catch(() => null)` 兜住）", async () => {
  const response = await ctx.post("/api/templates/from-url", "{不是 JSON", { baseUrl: server.baseUrl });
  assert.equal(response.status, 400, "坏 JSON 也要走到同一个 400，不能 500");
});

test("401：strict 下缺访问上下文 → 401，且不产生副作用", async () => {
  const before = await jobCount(ctx.sandbox);
  const response = await ctx.post(
    "/api/templates/from-url",
    { url: "https://example.com" },
    { baseUrl: server.baseUrl, headers: null },
  );
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; message: string };
  assert.equal(body.error, "access_context_required");
  assert.match(body.message, /[一-龥]/);
  assert.equal(await jobCount(ctx.sandbox), before, "鉴权失败不许产生副作用");
});

test("502：抓取失败（capture）→ 502 + 中文文案 + 留下可恢复的 jobId", async () => {
  stubUrlOrchestrator(CAPTURE_FAILED);
  const response = await ctx.post("/api/templates/from-url", { url: "https://example.com" }, { baseUrl: server.baseUrl });
  assert.equal(response.status, 502, "外部原因（抓不到）→ 502，不是 422");
  const body = (await response.json()) as { error: string; message: string; jobId: string };
  assert.equal(body.error, "url_capture_failed");
  assert.match(body.message, /[一-龥]/, "自助场景下这句是客户唯一能读的");
  assert.ok(body.jobId, "失败也要留 jobId——用户回来能'接着做'");
});

test("422：整理失败（export，用户能自修）→ 422 而不是 502", async () => {
  stubUrlOrchestrator(EXPORT_FAILED);
  const response = await ctx.post("/api/templates/from-url", { url: "https://example.com" }, { baseUrl: server.baseUrl });
  assert.equal(response.status, 422, "用户能自己改的问题不该报成 502");
  assert.equal(((await response.json()) as { error: string }).error, "url_export_failed");
});

test("409：登记撞名 → 原样透传 409 + retryable（id 派生自基线表，不猜）", async () => {
  // ⚠️ 撞名要拿一个**必然存在**的 id。基线模板 id 是编译期常量，
  // 且 `templateIdFromUrl` 取主机名 slug——所以把 id 当主机名即可稳定复现。
  const baselineId = templates[0]?.id;
  assert.ok(baselineId, "基线模板表不该为空，否则这条断言的前提不成立");

  stubUrlOrchestrator({ ok: true, bundle: urlBundle({ templateId: baselineId }), capture: urlCapture() });
  const response = await ctx.post("/api/templates/from-url", { url: `https://${baselineId}` }, { baseUrl: server.baseUrl });

  assert.equal(response.status, 409, "撞名必须可分辨地报 409（前端据此提示'换个后缀'）");
  const body = (await response.json()) as { error: string; retryable?: boolean; message: string };
  assert.equal(body.error, "template_id_taken");
  assert.equal(body.retryable, true, "撞名是**可恢复**的，要如实告诉前端");
  assert.match(body.message, /[一-龥]/);
});

test("422：登记接口拒收（非 409 的非 2xx）→ 422，且不建站", async () => {
  // 造一个**必然被 runtime 的 zod 拒掉**的 templateId（大写 + 非法字符）
  stubUrlOrchestrator({ ok: true, bundle: urlBundle({ templateId: "非法-ID" }), capture: urlCapture() });
  const response = await ctx.post("/api/templates/from-url", { url: "https://probe.example.com" }, { baseUrl: server.baseUrl });

  assert.equal(response.status, 422);
  const body = (await response.json()) as { error: string; message: string; siteId?: unknown };
  assert.equal(body.error, "template_register_failed");
  assert.match(body.message, /[一-龥]/);
  assert.equal("siteId" in body, false, "登记都没过，不该冒出 siteId");
});

test("201：登记成功 → 返回可编辑槽位数，`createSite:false` 时不建站", async () => {
  // 这条是"替身没把成功路径也弄坏"的对照——上面全是失败分支，
  // 若只有失败断言，一个"永远失败"的 bug 也能全绿（假门禁）。
  stubUrlOrchestrator({ ok: true, bundle: urlBundle({ templateId: "substitution-ok-a2" }), capture: urlCapture() });
  const response = await ctx.post(
    "/api/templates/from-url",
    { url: "https://probe.example.com", createSite: false },
    { baseUrl: server.baseUrl },
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { ok: boolean; templateId: string; siteId: null; editable: number; slots: string[] };
  assert.equal(body.ok, true);
  assert.equal(body.templateId, "substitution-ok-a2");
  assert.equal(body.siteId, null, "没要建站就不该建");
  // 槽位是**真实下游**从 HTML 里清点出来的事实（h1 → hero.title），不是我们塞的
  assert.ok(body.slots.length > 0, "A 的产物至少要有一个可识别槽位，否则登记会被质量门拒");
  assert.equal(body.editable, body.slots.length, "editable 与 slots 必须同源，前端两个都用");
});

test("替身基建 · 键放错模块必须**红**，不许遍历取到值（本轮修掉的静默洞）", () => {
  // 早期 `fakeOr` 遍历所有内层表，于是"把 A 模块的键写进 B 模块那一格"照样取值，
  // 「替身作用域」这层约束被无声绕过。现在按 alias 精确查。
  // 同构用例的完整版在 `tests/template-route-from-screenshot.test.ts`（那边专门测它）。
  armSubstitutions({ "@/lib/template-from-url": { createTemplateFromUrl: CAPTURE_FAILED } });
  assert.throws(
    () => fakeOr("@/lib/template-from-screenshot", "createTemplateFromScreenshot"),
    /没有 @\/lib\/template-from-screenshot 这一格/,
  );
  assert.throws(() => fakeOr("@/lib/template-from-url", "createTemplatFromUrl"), /没有 createTemplatFromUrl/);
  const first = fakeOr("@/lib/template-from-url", "createTemplateFromUrl") as { message?: string };
  first.message = "被调用方改过了";
  const second = fakeOr("@/lib/template-from-url", "createTemplateFromUrl") as { message?: string };
  assert.equal(second.message, (CAPTURE_FAILED as { message: string }).message);
});

test("替身基建 · 函数不是合法替身值（JSON 会把它吃掉变成 undefined，所以当场拒收）", () => {
  assert.throws(
    () => armSubstitutions({ "@/lib/x": { fn: (() => 1) as unknown as string } }),
    /只收数据/,
  );
});

test("替身基建 · loader 与本模块的 env 名必须同源（两处定义会漂移，所以要断言）", async () => {
  // ⚠️ loader 跑在**解析钩子线程**里，不能 import .ts，所以 env 名在那里是**手写**的。
  // 手写就可能漂移，漂移的后果是"替身配了但钩子看不见"——静默失效。这条把它钉住。
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./alias-loader.mjs", import.meta.url), "utf8");
  const declared = /const SUBSTITUTION_ENV = "([^"]+)"/.exec(source)?.[1];
  assert.equal(declared, "SITECRAFT_TEST_SUBSTITUTIONS");
  assert.equal(declared, (await import("../lib/testing/substitution.ts")).SUBSTITUTION_ENV);
});

test("loader 负向验证 · 替身**确实由解析钩子**生效（探针取证，不是推断）", () => {
  // 军规 2：新增的检查必须证明它会失败。这条测的是**钩子本身**——
  // 若有人把 `resolve()` 里的替身分支删了/写错了，替身不会生效，
  // 上面那些 409/201 会退回真实现并崩，而**这一条会直接指认原因**。
  //
  // 取证方式：钩子线程把每次解析落盘（`SITECRAFT_TEST_SUBSTITUTION_PROBE`），
  // 测试进程读那个文件——两个全局对象之间只能靠文件通信。
  const log = readFileSync(PROBE_PATH, "utf8");
  assert.match(
    log,
    /^substituted	@\/lib\/template-from-url	/m,
    "解析钩子必须把 @/lib/template-from-url 指到替身文件——否则本文件测的根本不是替身",
  );
  // 反向的也要在：**非**替身的 @/ 别名走的是普通别名解析，不能被误标成 substituted
  assert.match(log, /^resolved	@\/lib\/request-context	/m, "普通别名应当走 resolved 分支");
  assert.doesNotMatch(log, /^substituted	@\/lib\/request-context/m, "没配替身的模块不许被替换");
});
