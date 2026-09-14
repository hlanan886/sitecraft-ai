import { spawn } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import {
  POSTGRES_IN_CONTAINER_PORT,
  resolvePostgresPort,
  resolveServerEnv,
  resolveStoreBackend,
} from "./pg-target.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const buildId = path.join(root, ".next", "BUILD_ID");

function runNode(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Command exited with ${code}`)));
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Port ${port} did not become ready within ${timeoutMs}ms`);
}

async function newestSourceMtime(directory) {
  let newest = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".next", "node_modules", "playwright-report", "test-results"].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestSourceMtime(file));
    else if (/\.(?:ts|tsx|js|mjs|css|json)$/.test(entry.name)) newest = Math.max(newest, (await stat(file)).mtimeMs);
  }
  return newest;
}

/**
 * 端口来自 pg-target.mjs（单一来源），不再硬编码。
 *
 * ⚠️ 这里检查的是**宿主机映射端口**，不是容器内的 5432——
 * compose 的 `5433:5432` 意味着宿主机听 5433、容器内听 5432。
 * 拿容器内端口做检查就是检查一个永远不通的端口（假门禁）。
 */
async function ensurePostgres() {
  const port = resolvePostgresPort();
  if (await portOpen(port)) return;
  if (process.env.E2E_SKIP_DOCKER === "1") {
    throw new Error(`Postgres is unavailable on 127.0.0.1:${port} and E2E_SKIP_DOCKER=1`);
  }
  const compose = process.platform === "win32" ? "docker.exe" : "docker";
  await new Promise((resolve, reject) => {
    const child = spawn(compose, ["compose", "up", "-d", "postgres"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`docker compose exited with ${code}`)));
  });
  // 等映射端口，不是容器内端口：容器起来不等于映射已生效。
  await waitForPort(port, 60_000);
  if (port === POSTGRES_IN_CONTAINER_PORT) return;
  // 自证：compose 的映射与我们要连的端口必须一致，否则又是一次假门禁。
  console.log(`[e2e] postgres 宿主机端口 ${port}（容器内 ${POSTGRES_IN_CONTAINER_PORT}）`);
}

async function needsBuild() {
  if (process.env.E2E_FORCE_BUILD === "1") return true;
  try {
    await access(buildId);
    return (await stat(buildId)).mtimeMs < await newestSourceMtime(root);
  } catch {
    return true;
  }
}

const backend = resolveStoreBackend();
if (backend === "file") {
  console.log("[e2e] 存储后端：file（E2E_STORE=file，跳过 Postgres 准备）");
} else {
  await ensurePostgres();
}
if (await needsBuild()) await runNode([nextBin, "build"]);

/**
 * ⚠️ **文件后端模式已放弃**（2026-09-12，用户裁决 2：「若仍要动 lib/ 或改守卫，
 * 就地放弃，把门禁 3 正式降级为『仅 PG 后端』并登记 T-9」）。
 *
 * 三条路都试过，全部失败，且**都不在 e2e 红线内可解**：
 *
 * | 尝试 | 结果 |
 * |---|---|
 * | ① `next start` + env `NODE_ENV=development` | 被 `next start` 覆盖 → driver 仍是 postgres |
 * | ② `next start --require <preload>` 预加载钉住 NODE_ENV | `next` CLI 不认该参数：`unknown option '--require'` |
 * | ③ `next dev` | 撞 `.next/dev/lock`：`Another next dev server is already running`（PID 26872，用户在跑的开发服务器） |
 *
 * 根因：三个 store 的判定是 `SITE_STORE === "postgres" || NODE_ENV === "production"`，
 * `next start` 必然把 NODE_ENV 设成 production，于是**文件后端在生产形态下不可达**。
 * 绕过它要么改 `lib/`（三处判定或生产守卫），要么改 `next.config.*`（配独立 distDir
 * 才能与在跑的 dev server 共存）——**两者都在本批红线之外**。
 *
 * 所以：**e2e 只跑 PG 后端**。文件后端在单元级已覆盖
 * （`tests/site-store-op-rename.test.ts` 走真实文件读写 + 归一化 + undo 重放）。
 */
const serverArgs = [nextBin, "start", "-p", "3210"];

/**
 * 可选：本地模型 stub（阶段 0.3）。
 *
 * **只在 `E2E_AI_STUB=1` 时启用**——默认不注入任何东西，现有 spec 的行为逐字节不变。
 *
 * 开的时候把 `DEEPSEEK_BASE_URL` 指到本地 stub，于是"截图/URL → 模板"整条链路里
 * **只有模型是假的**：前端、路由、编排、拼装、登记、建站全部真跑。
 * 这比在浏览器层拦 `/api/templates/from-*`（那样连路由都不执行）真实得多。
 *
 * 用环境变量开关、而不是新加一个 serve 脚本，是为了不复制这套
 * "建 + 迁移 + 起服务"的启动逻辑；关掉时零影响。
 */
const stubEnabled = process.env.E2E_AI_STUB === "1";
let aiStub = null;
let aiStubUrl = null;
let aiStubArgs = {};
if (stubEnabled) {
  const { startAiStub, portInUse, DEFAULT_STUB_PORT } = await import("./ai-stub.mjs");
  const stubPort = Number(process.env.E2E_AI_STUB_PORT || DEFAULT_STUB_PORT);
  if (await portInUse(stubPort)) {
    // 不静默挑端口：换了端口，被测服务连的就不是我们以为的那个 stub，
    // 而测试照样绿——那是最难查的一类假绿。
    console.error(`[e2e] 端口 ${stubPort} 已被占用，模型 stub 起不来。请先关掉占用它的进程再跑。`);
    process.exit(1);
  }
  aiStub = await startAiStub({ port: stubPort });
  aiStubUrl = aiStub.url;
  aiStubArgs = {
    DEEPSEEK_BASE_URL: aiStub.url,
    DEEPSEEK_API_KEY: "e2e-stub-key",
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "sitecraft-e2e-stub",
  };
  console.log(`[e2e] 模型 stub 已启用：${aiStub.url} → 被测服务的 DEEPSEEK_BASE_URL`);
}

/**
 * 访问模式：**外部显式指定则尊重，否则 relaxed**。
 *
 * ## ⚠️ 这里此前是写死的 `"relaxed"`，那是个**假门禁**
 *
 * `scripts/run-strict-access.mjs` 会把 `SITECRAFT_ACCESS_MODE=strict` 传给
 * playwright，但本行把它**覆盖掉**了——于是 `access-isolation.spec.ts`
 * 断言 strict 行为（无头 → 401）时，服务其实跑在 relaxed 下，
 * **这条断言从来没在它声称的条件下跑过**（实测：无头 `GET /api/sites` 返 200，不是 401）。
 *
 * 「显式传了却被无声覆盖」与 `register({ data })` 那个坑同族：**参数到了，
 * 但中间层把它丢了**。所以这里改成"外部给了就用外部的"。
 *
 * relaxed 仍是默认：e2e helper 不带访问头，本来就是本地测试环境；
 * 只有**生产**才必须 strict。需要 strict 的批次（`test:e2e:strict-access`、
 * 0.6 的 strict 冒烟）自己显式传。
 */
const accessMode = process.env.SITECRAFT_ACCESS_MODE?.trim() || "relaxed";

const server = spawn(process.execPath, serverArgs, {
  cwd: root,
  // resolveServerEnv 决定 SITE_STORE 与 DATABASE_URL——
  // 与 global-setup / preflight 的端口检查**同源**，所以"检查的"就是"服务连的"。
  env: { ...resolveServerEnv(process.env), PORT: "3210", SITECRAFT_ACCESS_MODE: accessMode, ...aiStubArgs },
  stdio: "inherit",
});

/** 关服务时把 stub 一并关掉——单独留着它会变成下次 run 的"端口已占用"。 */
const stopStub = () => {
  if (aiStub) void aiStub.close();
};

const stop = () => {
  stopStub();
  if (!server.killed) server.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.once("error", (error) => { console.error(error); process.exitCode = 1; });
server.once("exit", (code) => { stopStub(); process.exitCode = code ?? 1; });
