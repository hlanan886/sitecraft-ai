/**
 * `from-screenshot` 路由的**错误分支 + 登记成功**端到端真测（队列 B2 / 阶段 0.4）。
 *
 * 与 `tests/template-route-from-url.test.ts` 同构；两条路由的状态码口径必须一致，
 * 所以两边的分支一一对应地钉住。
 *
 * ⚠️ **本文件只 import 一次 `setupSubstitutedRoute`**：`lib/pending-job.ts` 的
 * `JOBS_DIR` 是模块加载时按 cwd 冻结的常量，同进程换沙箱不会重算——
 * 第二个沙箱里的计数恒为 0（假门禁）。`node --test` 每文件独立进程，
 * 所以"一文件一路由"是正确切分。
 *
 * ⚠️ **201 那条是 P0 的回归钉**（用户 2026-09-13 点名的）：
 * 路由转调登记时曾漏转 `x-sitecraft-workspace-id`，导致 strict 态下转调必 401。
 * 这条断言把"登记真的走得通"钉死——修之前它红，修之后才绿。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft, templates } from "../lib/site-model.ts";
import { armSubstitutions, fakeOr } from "../lib/testing/substitution.ts";
import { serveRoute, setupSubstitutedRoute } from "./helpers/substitution.ts";
import { jobCount } from "./helpers/fixtures-from-url.ts";

const ctx = await setupSubstitutedRoute(
  { "@/lib/template-from-screenshot": { createTemplateFromScreenshot: { ok: false, step: "read", message: "找不到这张图。" } } },
  new URL("../app/api/templates/from-screenshot/route.ts", import.meta.url).href,
);
const runtime = await import(new URL("../app/api/templates/runtime/route.ts", import.meta.url).href);
const server = await serveRoute("POST", (request) => runtime.POST(request));
test.after(async () => {
  await server.close();
  await ctx.teardown();
});

const stub = (result: unknown) =>
  armSubstitutions({ "@/lib/template-from-screenshot": { createTemplateFromScreenshot: result } });

/** B 轨的最小合法产物——形状必须与 `TemplateBundle` 一致（下游真跑）。 */
function bundle(overrides: Record<string, unknown> = {}) {
  return {
    templateId: "substitution-probe-b1",
    name: "替身探针（截图）",
    category: "制造业",
    description: "替身测试用",
    // ⚠️ 槽位属性**必须打上**：B 轨登记**不带** `skipQualityGate`（A 轨才带），
    // 而质量门要求「hero.title + 至少一个集合槽」（`lib/template-quality-gate.ts:66-71`，
    // 集合判定见 `lib/template-runtime.ts:308`）。少了它登记会被 422 拒——
    // 那是**真实的一层**，不是测试障碍，所以夹具要喂合法输入而不是放宽断言。
    html: [
      "<html><body>",
      "<h1 data-sitecraft-slot=\"hero.title\">某某机械制造有限公司</h1>",
      "<ul data-sitecraft-slot=\"features.items\">",
      "<li data-sitecraft-slot=\"features.items.0.title\">精密加工</li>",
      "</ul>",
      "</body></html>",
    ].join(""),
    assets: {},
    binaryAssets: {},
    initialDraft: null,
    tokens: { primary: "#111111", secondary: "#222222", accent: "#333333" },
    summary: "看起来像企业官网",
    warnings: [],
    stats: { model: "替身", latencyMs: 1, visionMs: 1, composeMs: 1, shotMs: 0 },
    ...overrides,
  };
}

const understanding = {
  content: { companyName: "某某机械", industry: "制造业", siteName: "某某机械" },
  blocks: [{ type: "hero" }],
};

const UPLOAD = { source: { kind: "upload", urlPath: "shot.png" } };

// ============================================================ 错误分支

test("400：source 形状不对 → 拦在编排层之前（连 job 都没记）", async () => {
  stub({ ok: false, step: "read", message: "找不到这张图。" });
  const before = await jobCount(ctx.sandbox);
  const response = await ctx.post("/api/templates/from-screenshot", { source: { kind: "upload" } }, { baseUrl: server.baseUrl });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string; details: { fieldErrors: Record<string, string[]> } };
  assert.equal(body.error, "Invalid request");
  assert.ok(body.details.fieldErrors.source, "错误要指到 source");
  assert.equal(await jobCount(ctx.sandbox), before, "400 不该产生任何 job");
});

test("schema： discriminated union 按 kind 分流，而 zod 的 strict 对象**剥掉**多余字段", async () => {
  // ⚠️ **我最初把这条写成"必须 400"，实测证明是错的**（如实记录）：
  // zod 的对象**默认剥掉未知键**，所以 `{kind:"url", url, urlPath}` 会被
  // 判成合法的 url 分支（`urlPath` 直接丢掉），并**继续往下跑**——
  // 于是它走到编排层、由替身给出 read 失败 → 422。
  //
  // 所以这里断言的是**真实语义**，不是我以为的语义：
  // ① union 认得 url 分支（看到的是编排层的 422，不是 schema 的 400）；
  // ② 它**继续跑到了编排层**（带着 jobId），说明没被 schema 拦下。
  stub({ ok: false, step: "read", message: "找不到这张图。" });
  const response = await ctx.post(
    "/api/templates/from-screenshot",
    { source: { kind: "url", url: "https://example.com", urlPath: "a.png" } },
    { baseUrl: server.baseUrl },
  );
  assert.notEqual(response.status, 400, "多余字段会被 zod 剥掉，不该因此报 400");
  const body = (await response.json()) as { error: string; jobId?: string };
  assert.equal(body.error, "screenshot_read_failed", "应当分流到 url 分支并走到编排层");
  assert.ok(body.jobId, "走到了编排层才会记 job——这是'没被 schema 拦下'的证据");
});

test("401：strict 下缺访问上下文 → 401，且不产生副作用", async () => {
  const before = await jobCount(ctx.sandbox);
  const response = await ctx.post("/api/templates/from-screenshot", UPLOAD, { baseUrl: server.baseUrl, headers: null });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; message: string };
  assert.equal(body.error, "access_context_required");
  assert.match(body.message, /[一-龥]/);
  assert.equal(await jobCount(ctx.sandbox), before, "鉴权失败不许产生副作用");
});

test("422：读图失败（read，用户能自修）→ 422 + 中文 + 不夹带 siteId", async () => {
  stub({ ok: false, step: "read", message: "找不到这张图，可能上传时出错了。请重新上传一次。" });
  const response = await ctx.post("/api/templates/from-screenshot", UPLOAD, { baseUrl: server.baseUrl });

  assert.equal(response.status, 422);
  const body = (await response.json()) as { error: string; message: string; siteId?: unknown };
  assert.equal(body.error, "screenshot_read_failed");
  assert.match(body.message, /[一-龥]/);
  assert.equal("siteId" in body, false, "失败的响应不许夹带 siteId");
});

test("422：看图失败（vision）→ 422，并带上 detail 便于排查", async () => {
  stub({ ok: false, step: "vision", message: "读这张图时出错了。", detail: "timeout" });
  const response = await ctx.post("/api/templates/from-screenshot", UPLOAD, { baseUrl: server.baseUrl });

  assert.equal(response.status, 422);
  const body = (await response.json()) as { error: string; detail?: string };
  assert.equal(body.error, "screenshot_vision_failed");
  assert.equal(body.detail, "timeout", "detail 要原样带出来（排障靠它）");
});

test("422：拼装失败（compose）→ 422", async () => {
  stub({ ok: false, step: "compose", message: "拼装版面时出错了。" });
  const response = await ctx.post("/api/templates/from-screenshot", UPLOAD, { baseUrl: server.baseUrl });
  assert.equal(response.status, 422);
  assert.equal(((await response.json()) as { error: string }).error, "screenshot_compose_failed");
});

test("502：抓取失败（capture，外部原因）→ 502 而不是 422", async () => {
  stub({ ok: false, step: "capture", message: "这个网址没能截出图来。" });
  const response = await ctx.post(
    "/api/templates/from-screenshot",
    { source: { kind: "url", url: "https://example.com" } },
    { baseUrl: server.baseUrl },
  );
  assert.equal(response.status, 502, "外部原因 → 502；与 from-url 的口径必须一致");
  assert.equal(((await response.json()) as { error: string }).error, "screenshot_capture_failed");
});

test("409：登记撞名 → 原样透传 409 + retryable（id 派生自基线表，不猜）", async () => {
  const baselineId = templates[0]?.id;
  assert.ok(baselineId, "基线模板表不该为空，否则这条断言的前提不成立");

  stub({ ok: true, bundle: bundle({ templateId: baselineId }), understanding });
  const response = await ctx.post("/api/templates/from-screenshot", { ...UPLOAD, createSite: false }, { baseUrl: server.baseUrl });

  assert.equal(response.status, 409, "撞名必须可分辨地报 409（前端据此提示'换个后缀'）");
  const body = (await response.json()) as { error: string; retryable?: boolean; message: string };
  assert.equal(body.error, "template_id_taken");
  assert.equal(body.retryable, true, "撞名是**可恢复**的，要如实告诉前端");
  assert.match(body.message, /[一-龥]/);
});

// ============================================================ 登记成功（P0 回归钉）

test("201：登记成功 → 槽位/editable 同源，`createSite:false` 不建站", async () => {
  // ⚠️ **这条是转调漏转 workspace 头的回归钉**（用户 2026-09-13 点名要求）。
  // strict 态下转调若丢头 → runtime 路由 401 → 路由归成 422，这条立刻红。
  stub({ ok: true, bundle: bundle({ templateId: "substitution-ok-b2" }), understanding });
  const response = await ctx.post(
    "/api/templates/from-screenshot",
    { ...UPLOAD, createSite: false },
    { baseUrl: server.baseUrl },
  );

  assert.equal(response.status, 201, "strict 态下登记必须真的走得通——这正是 P0 修复的验收点");
  const body = (await response.json()) as {
    ok: boolean;
    templateId: string;
    siteId: null;
    editable: number;
    slots: string[];
    understanding: { companyName: string; blocks: string[] };
  };
  assert.equal(body.ok, true);
  assert.equal(body.templateId, "substitution-ok-b2");
  assert.equal(body.siteId, null, "没要建站就不该建");
  // 槽位是**真实下游**从 HTML 清点出来的事实，不是我们塞的
  assert.ok(body.slots.length > 0, "B 的产物至少要有一个可识别槽位");
  assert.equal(body.editable, body.slots.length, "editable 与 slots 必须同源（前端两个都用）");
  // 两个路由必须返回同一组字段——前端弹窗用同一个组件渲染
  assert.equal(body.understanding.companyName, "某某机械");
  assert.deepEqual(body.understanding.blocks, ["hero"]);
});

test("201：`createSite:true` 时**真的建站**并回 jobId（默认值就是 true）", async () => {
  // ⚠️ 建站那条要求 `initialDraft` **是合法草稿**：路由会先 `siteDraftSchema.safeParse`
  // 它，再交给 `createSite`（`createSite` 自己**不校验**，脏草稿会在读取时才炸）。
  // 草稿从权威默认值 `defaultDraft` 派生，不手抄字段。
  const draft = structuredClone(defaultDraft);
  draft.templateId = "substitution-ok-b3";
  draft.siteName = "某某机械";
  draft.companyName = "某某机械";

  stub({ ok: true, bundle: bundle({ templateId: "substitution-ok-b3", initialDraft: draft }), understanding });
  const response = await ctx.post("/api/templates/from-screenshot", UPLOAD, { baseUrl: server.baseUrl });

  assert.equal(response.status, 201);
  const body = (await response.json()) as { siteId: string | null };
  assert.ok(body.siteId, "B 轨默认就该建站——客户要的是'能看的站'，不是模板文件");
});

// ============================================================ 替身自身（军规 2）

test("替身基建 · 键放错模块必须**红**，不许遍历取到值（本轮修掉的静默洞）", () => {
  // 早期 `fakeOr` 遍历所有内层表，于是"把 A 模块的键写进 B 模块那一格"照样取值，
  // 「替身作用域」这层约束被无声绕过。现在按 alias 精确查，必须抛。
  armSubstitutions({ "@/lib/template-from-screenshot": { createTemplateFromScreenshot: { ok: false, step: "read", message: "x" } } });
  assert.throws(
    () => fakeOr("@/lib/template-from-url", "createTemplateFromUrl"),
    /没有 @\/lib\/template-from-url 这一格/,
    "表里根本没这一格，必须抛——静默返回 undefined 只会让路由以 TypeError 崩",
  );
  assert.throws(
    () => fakeOr("@/lib/template-from-screenshot", "createTemplatFromScreenshot"),
    /没有 createTemplatFromScreenshot/,
    "拼错键名必须抛",
  );
  // 正确的 alias + 名字照样取到，且是副本
  const first = fakeOr("@/lib/template-from-screenshot", "createTemplateFromScreenshot") as { message: string };
  first.message = "被调用方改过了";
  assert.equal(
    (fakeOr("@/lib/template-from-screenshot", "createTemplateFromScreenshot") as { message: string }).message,
    "x",
    "取到的必须是副本，否则用例之间会串",
  );
});
