/**
 * 替身测试的公共夹具：装表 → 起沙箱 → import 路由。
 *
 * 存在的理由：`register()` + `process.env` + `chdir` + 动态 `import` 这四步的**顺序**
 * 是硬约束（ESM 静态 import 会先求值，env 必须先到位），散在三个测试文件里各写一遍
 * 迟早有人抄错。这里收一处，并在注释里写清每一步**为什么**不能换位置。
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import { register } from "node:module";
import { armSubstitutions, disarmSubstitutions } from "../../lib/testing/substitution.ts";

/** 三个头缺任一个就是 401（见 `lib/request-context.ts`）。 */
export const ACCESS_HEADERS = {
  "x-sitecraft-workspace-id": process.env.DEFAULT_WORKSPACE_ID?.trim() || "demo",
  "x-sitecraft-actor-id": "route-substitution-test",
  "x-sitecraft-role": "editor",
};

/**
 * 自持 HTTP 服务器：把**真实的**某个路由挂在本地端口上。
 *
 * ## 为什么需要它
 *
 * 两个 POST 路由的 409/422 不是自己算出来的，是**转调 `/api/templates/runtime`
 * 的响应**。要断到这两条分支，就得让那次转调真的发生——而 `request.url` 决定
 * 转调打到哪，所以只要发一个 URL 指向本服务器的 Request 即可。
 *
 * 比起 mock `globalThis.fetch`：那样连"转调真的发出去过"都测不到，
 * 而且真正的 runtime 路由一行都没跑。这里跑的是**真实路由**，
 * 只是它在一个真实端口后面（转调本来就是 HTTP，这样反而更真）。
 */
export type RouteServer = { baseUrl: string; close: () => Promise<void> };

export async function serveRoute(
  method: "POST" | "GET",
  handler: (request: Request) => Promise<Response>,
): Promise<RouteServer> {
  const server = createServer((nodeReq, nodeRes) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
      const url = `http://127.0.0.1:${(nodeReq.socket.address() as { port: number }).port}${nodeReq.url}`;
      // 只转发路由关心的东西：方法、头、体。真实路由自己判鉴权、自己解析 body。
      const request = new Request(url, {
        method: nodeReq.method,
        headers: nodeReq.headers as Record<string, string>,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const response = await handler(request);
      nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
      nodeRes.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      nodeRes.writeHead(500);
      nodeRes.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器没拿到端口");
  void method;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export type SubstitutionSetup = {
  /** 沙箱目录（已 `chdir` 到这里）。 */
  sandbox: string;
  /** 发一个 POST 到某个路由的便捷函数。 */
  post: (
    pathname: string,
    body: unknown,
    options?: { baseUrl?: string; headers?: Record<string, string> | null },
  ) => Promise<Response>;
  /** 收尾：恢复 cwd、删沙箱、清替身表。 */
  teardown: () => Promise<void>;
};

/**
 * 装好替身与沙箱，然后 import 指定路由。
 *
 * ⚠️ **顺序不可换**：
 * 1. 先把替身表落盘 + 设 env（`armSubstitutions`），否则 loader 在解析时读不到；
 * 2. 再 `register(loader)`；
 * 3. 再 `chdir` 到沙箱——`lib/pending-job.ts` 的 `JOBS_DIR` 是**模块加载时**按 cwd
 *    算的常量，晚一步 job 就写进仓库自带的 `.sitecraft-data/`（真数据目录）；
 * 4. **最后**才动态 `import` 路由。
 */
export async function setupSubstitutedRoute(
  script: Record<string, Record<string, unknown>>,
  /** 路由模块的**绝对** URL（调用方用 `new URL("../app/...", import.meta.url).href` 造）。 */
  routeModule: string,
): Promise<{ module: unknown } & SubstitutionSetup> {
  const sandbox = await mkdtemp(path.join(tmpdir(), "sitecraft-substitution-"));
  const cwdBefore = process.cwd();

  armSubstitutions(script);
  register("../../tests/alias-loader.mjs", import.meta.url);
  process.chdir(sandbox);

  // ⚠️ 相对路径要按**调用方文件**解析，不是按本 helpers 文件——
  // 直接 `import("../app/...")` 会解析成 `tests/app/...`（实测报错）。
  // 所以要求调用方传 `new URL("../app/...", import.meta.url).href`。
  const module = await import(routeModule);

  /**
   * ⚠️ `baseUrl` 是**必填**的：路由转调登记接口时用的是 `new URL(path, request.url)`，
   * `request.url` 的 origin 决定转调打到哪。默认 `http://localhost` 会让转调
   * 打到一个没人听的端口 → 路由以 `fetch failed` 崩，而不是走到我们想测的分支。
   */
  const post = (
    pathname: string,
    body: unknown,
    options: { baseUrl?: string; headers?: Record<string, string> | null } = {},
  ) =>
    (module as { POST: (request: Request) => Promise<Response> }).POST(
      new Request(`${options.baseUrl ?? "http://localhost"}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // `headers: null` 用于专门测鉴权——一个头都不带
          ...(options.headers === null ? {} : (options.headers ?? ACCESS_HEADERS)),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  return {
    module,
    sandbox,
    post,
    teardown: async () => {
      process.chdir(cwdBefore);
      disarmSubstitutions();
      await rm(sandbox, { recursive: true, force: true });
    },
  };
}

/** 沙箱里有没有落过盘——"不写盘"这类断言直接查它就够。 */
export function sandboxIsEmpty(sandbox: string): boolean {
  return !existsSync(path.join(sandbox, ".sitecraft-data"));
}
