import { spawn } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

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

async function ensurePostgres() {
  if (await portOpen(5432)) return;
  if (process.env.E2E_SKIP_DOCKER === "1") throw new Error("Postgres is unavailable on 5432 and E2E_SKIP_DOCKER=1");
  const compose = process.platform === "win32" ? "docker.exe" : "docker";
  await new Promise((resolve, reject) => {
    const child = spawn(compose, ["compose", "up", "-d", "postgres"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`docker compose exited with ${code}`)));
  });
  await waitForPort(5432, 60_000);
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

await ensurePostgres();
if (await needsBuild()) await runNode([nextBin, "build"]);

const server = spawn(process.execPath, [nextBin, "start", "-p", "3210"], {
  cwd: root,
  env: { ...process.env, PORT: "3210" },
  stdio: "inherit",
});

const stop = () => {
  if (!server.killed) server.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.once("error", (error) => { console.error(error); process.exitCode = 1; });
server.once("exit", (code) => { process.exitCode = code ?? 1; });
