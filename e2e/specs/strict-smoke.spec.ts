/**
 * strict 生产形态的**只读冒烟**（0.6 第 5 项）。
 *
 * ## 它测什么（以及不测什么）
 *
 * 测的是**部署形态本身**：服务以 strict 起（真实生产的默认），三个核心入口的
 * **只读**端点，`带对鉴权头 → 2xx`、`缺头 → 401`。
 *
 * **不测业务逻辑**——那是别的 spec 的事。与 `access-isolation.spec.ts` 互补、不合并：
 *
 * | | `access-isolation` | 本 spec |
 * |---|---|---|
 * | 关注 | 鉴权**语义**（403 越权 / 角色 / 公开站点读） | 部署形态**是否会 401** |
 * | 深度 | 一个端点，多分支 | 三个入口，各一条 |
 * | 跑法 | `npm run test:e2e:strict-access` | 同一个 runner（同样需要 strict 服务） |
 *
 * ## 为什么非有不可（T-13 双断链的教训）
 *
 * dev 全 relaxed、e2e 亦 relaxed，**strict 生产形态此前零覆盖**。
 * 前端不发头（T-13）+ 后端转调丢头（`de10d83`）因此长期隐身。
 * 这条 spec 不修那两个缺陷，但让"生产形态根本没跑过"这件事**不再成立**。
 *
 * ## 运行方式（关键）
 *
 * 本 spec 断言的是 strict 行为，**必须以 strict 服务运行**：
 *
 * ```bash
 * npm run test:e2e:strict-access          # 只跑 access-isolation
 * npx playwright test e2e/specs/strict-smoke.spec.ts   # 需先手动以 strict 起服务
 * ```
 *
 * ⚠️ **若服务跑在 relaxed，本 spec 会红**——这是有意的（它测的就是 strict）。
 * `serve.mjs` 已改成"外部显式给了就尊重"，所以只要运行时装了
 * `SITECRAFT_ACCESS_MODE=strict` 就能拿到 strict 服务。
 */
import { test, expect } from "@playwright/test";

const ACCESS_HEADERS = {
  "x-sitecraft-workspace-id": process.env.DEFAULT_WORKSPACE_ID?.trim() || "demo",
  "x-sitecraft-actor-id": "strict-smoke",
  "x-sitecraft-role": "editor",
};

/**
 * 三个核心入口的**只读**端点。
 *
 * 选的是"用户一眼能看出坏了"的三条路：
 * 站点库（打开就有）、模板库（建站入口）、生成记录（诊断面板）。
 * 全部只读——冒烟不该改任何数据。
 */
const READ_ENDPOINTS = [
  { path: "/api/sites", entry: "站点库（首页打开就有）" },
  { path: "/api/templates/runtime", entry: "模板库（建站入口）" },
  { path: "/api/generation-records", entry: "生成记录（诊断面板）" },
] as const;

test.describe("strict 生产形态 · 只读冒烟", () => {
  for (const { path, entry } of READ_ENDPOINTS) {
    test(`${entry} · ${path}：缺头 → 401`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status(), `${path} 在 strict 下缺访问上下文必须是 401`).toBe(401);
      const body = (await response.json()) as { error?: string; message?: string };
      expect(body.error).toBe("access_context_required");
      // 文案要能读——自助场景下它可能出现在日志/工单里
      expect(body.message ?? "").toMatch(/[一-龥]/);
      // 401 不许被缓存（否则代理会把 401 发给合法用户）
      expect(response.headers()["cache-control"]).toBe("no-store");
    });

    test(`${entry} · ${path}：带对三头 → 2xx（且是 JSON）`, async ({ request }) => {
      const response = await request.get(path, { headers: ACCESS_HEADERS });
      expect(response.status(), `${path} 带对鉴权头必须放行`).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);
      expect(response.headers()["content-type"] ?? "").toContain("json");
      // 只读冒烟**不校验业务形状**（那是各功能 spec 的事）；但绝不能是错误体
      const body = (await response.json()) as { error?: string };
      expect(body.error, "2xx 响应里不该带错误码").toBeUndefined();
    });
  }

  test("三个头缺任意一个都算缺（不只测全缺）", async ({ request }) => {
    // 只测"全部缺"会漏掉"只转发了一部分"这一类真实缺陷——
    // de10d83 那个 P0 正是"转了 role + actor，漏了 workspace"。
    const partials: Array<[string, Record<string, string>]> = [
      ["缺 workspace", { "x-sitecraft-actor-id": "a", "x-sitecraft-role": "editor" }],
      ["缺 actor", { "x-sitecraft-workspace-id": "demo", "x-sitecraft-role": "editor" }],
      ["缺 role", { "x-sitecraft-workspace-id": "demo", "x-sitecraft-actor-id": "a" }],
    ];
    for (const [label, headers] of partials) {
      const response = await request.get("/api/sites", { headers });
      expect(response.status(), `${label} 也必须 401——这正是一次"只转了一半"的缺陷形态`).toBe(401);
    }
  });
});
