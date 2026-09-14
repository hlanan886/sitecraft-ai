/**
 * e2e 的 Postgres 目标解析——**单一来源**（2026-09-12）。
 *
 * ## 为什么需要
 *
 * 此前 `5432` 被**硬编码在三处**：`global-setup.ts:15`、`serve.mjs:50/58`、
 * `preflight.mjs:33`。而 compose 的 postgres 映射改成 `5433:5432` 之后，
 * 三处全部指向一个**不存在的端口**，e2e 直接起不来。
 *
 * 硬编码的体检端口 = 假门禁：它检查的未必是服务真正连的那个端口。
 * 所以这里把"目标"收成一个函数，三处都从它取。
 *
 * ## ⚠️ 两个端口必须分清楚（这是最容易搞错的一层）
 *
 * - **宿主机映射端口**（`5433`）：e2e 的 `waitForPort` / `portOpen` 检查的是**它**，
 *   也是 `.env` 的 `DATABASE_URL` 里那个端口。
 * - **容器内端口**（`5432`）：postgres 进程在容器里监听的端口，**不变**。
 *
 * 所以"检查宿主机 5433 通不通"与"容器内是 5432"并不矛盾——
 * 恰恰相反，**映射存在时两者必然不同**。把容器内端口拿去当检查目标，
 * 就会得到"检查一个永远不通的端口"这种假门禁。
 */

/** 容器内端口，**固定不变**（compose 里 `POSTGRES` 进程监听的端口）。 */
export const POSTGRES_IN_CONTAINER_PORT = 5432;

/**
 * 缺省宿主机端口 = compose 的映射端口。
 *
 * ⚠️ **刻意不是 5432**：本机（以及任何 5432 被占用的环境）用 5432 当缺省
 * 等于"默认跑不通"。开箱即跑 > 向后兼容——将来 5432 空闲时，
 * 用户显式传 `DATABASE_URL` 或 `POSTGRES_PORT` 即可，不必改码。
 */
export const DEFAULT_POSTGRES_PORT = 5433;

function portFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    // URL 里省略端口时 postgres 的缺省是 5432
    return POSTGRES_IN_CONTAINER_PORT;
  } catch {
    return null;
  }
}

/**
 * 解析 e2e 要用的宿主机 PG 端口。
 *
 * 优先级：`POSTGRES_PORT`（显式覆盖）> `DEFAULT_POSTGRES_PORT`。
 *
 * ## ⚠️ 刻意**不读** `DATABASE_URL`（2026-09-12 实测的回归）
 *
 * 第一版把 `DATABASE_URL` 的端口排在缺省值前面，理由是"显式传参可覆盖"。
 * 但 `playwright.config.ts` 为修 T-7 加载了 `.env.local` 之后，
 * `DATABASE_URL` 变成了**仓库文件里那个 5432**——它**不保证与 compose 的映射一致**，
 * 于是 `serve.mjs` 又去等一个不存在的端口，端口修复**当场回归**。
 *
 * 结论：**e2e 的目标端口只能来自 compose 或显式传参，不能来自 `.env`。**
 * 这两个来源的语义不同——`.env` 描述"应用该连哪个库"，
 * compose 描述"e2e 实际起了哪个库"；混用就会得到这种"看起来配好了其实不通"的状态。
 *
 * 需要连别的库时显式传 `POSTGRES_PORT`（它优先级最高，不会被文件覆盖）。
 */
export function resolvePostgresPort(env = process.env) {
  const explicit = Number(env.POSTGRES_PORT);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  return DEFAULT_POSTGRES_PORT;
}

/**
 * 与端口配套的库名，供需要拼连接串的地方使用。
 *
 * ⚠️ 只取**库名**，不取端口——端口必须来自 compose/显式传参（见 `resolvePostgresPort`）。
 */
export function resolvePostgresDatabase(env = process.env) {
  if (env.POSTGRES_DATABASE) return env.POSTGRES_DATABASE;
  if (env.DATABASE_URL) {
    try {
      const name = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
      if (name) return name;
    } catch { /* 落到缺省 */ }
  }
  return "site_studio";
}

/** e2e 的存储后端。缺省 postgres（与 `next start` 下 NODE_ENV=production 的行为一致）。 */
export function resolveStoreBackend(env = process.env) {
  return env.E2E_STORE === "file" ? "file" : "postgres";
}

/**
 * 解析要传给被测服务的环境变量。
 *
 * **这是"检查目标"与"服务实际连接"保持一致的唯一保证点**：
 * `serve.mjs` 用本函数的返回值起服务，`global-setup.ts` / `preflight.mjs`
 * 用 `resolvePostgresPort()` 检查端口——两者同源。
 */
export function resolveServerEnv(baseEnv) {
  const backend = resolveStoreBackend(baseEnv);
  const host = baseEnv.POSTGRES_HOST || "127.0.0.1";
  const port = resolvePostgresPort(baseEnv);
  const database = resolvePostgresDatabase(baseEnv);
  return {
    ...baseEnv,
    SITE_STORE: backend === "file" ? "file" : "postgres",
    // 文件后端模式不要注入连接串：被测服务若还去连库，测试结果就掺了杂质。
    ...(backend === "file"
      ? { DATABASE_URL: "" }
      : { DATABASE_URL: `postgresql://${baseEnv.POSTGRES_USER || "postgres"}:${baseEnv.POSTGRES_PASSWORD || "postgres"}@${host}:${port}/${database}` }),
  };
}
