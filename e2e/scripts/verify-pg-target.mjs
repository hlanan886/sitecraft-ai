#!/usr/bin/env node
/**
 * 自证：**e2e 检查的端口 == 被测服务实际连接的端口 == compose 的真实映射**。
 *
 * ## 为什么需要（用户裁决 1 的实现要点）
 *
 * 「waitForPort 检查的是宿主机映射端口，不是容器内 5432——修完必须证明
 * 它检查的目标与 compose 实际映射一致，否则又是假门禁。」
 *
 * 这条太容易在将来悄悄坏掉：改 compose、改缺省值、改解析优先级，
 * 任意一处动了而另一处没跟上，e2e 就会变成"检查一个永远不通的端口"
 * 或"服务连的服务于另一个库"。两种都不会报错，只会静默跑偏。
 *
 * 所以把它变成**会红的检查**，而不是靠人记住。
 *
 * 用法：node e2e/scripts/verify-pg-target.mjs
 * 退出码 0 = 一致；1 = 不一致（打印差异）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_POSTGRES_PORT,
  POSTGRES_IN_CONTAINER_PORT,
  resolvePostgresPort,
  resolveServerEnv,
} from "./pg-target.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}: ${actual}${ok ? "" : `（期望 ${expected}）`}`);
  if (!ok) failures.push(label);
}

console.log("# e2e Postgres 目标自证\n");

// ---- 1. 从 compose 里**实读** postgres 服务的映射 ----
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
/**
 * 精确切出 postgres 服务块。
 *
 * ⚠️ 两个坑，都实际踩过：
 *  1. **不能全文匹配 `ports:`**——文件里 app 服务的 `3000:3000` 在前面，会先撞上它。
 *  2. **不能硬编码分隔符**——本仓库工作区的 compose 是 **CRLF**（`.gitattributes` 在
 *     checkout 时转换），`split("\n  postgres:\n")` 永远切不开。
 * 所以这里按行扫描，`\r` 一律先剥掉。
 */
const lines = compose.split("\n").map((line) => line.replace(/\r$/, ""));
let inPostgres = false;
let mapping = null;
for (const line of lines) {
  // 顶层服务键 = 恰好两个空格缩进 + 名字 + 冒号
  const serviceKey = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  if (serviceKey) {
    inPostgres = serviceKey[1] === "postgres";
    continue;
  }
  if (!inPostgres) continue;
  const ports = /^\s*ports:\s*\["(\d+):(\d+)"\]\s*$/.exec(line);
  if (ports) {
    mapping = ports;
    break;
  }
}
if (!mapping) {
  console.log(" FAIL  在 docker-compose.yml 的 postgres 服务块里找不到 ports 映射");
  process.exit(1);
}
const [, hostPort, containerPort] = mapping;
console.log(`compose postgres 映射：${hostPort}:${containerPort}（宿主机:容器内）\n`);

// ---- 2. 常量与 compose 一致 ----
check("容器内端口常量 == compose 右侧", POSTGRES_IN_CONTAINER_PORT, Number(containerPort));
check("缺省宿主机端口 == compose 左侧", DEFAULT_POSTGRES_PORT, Number(hostPort));

// ---- 3. 检查目标 == 服务连接目标（最关键的一条）----
const checked = resolvePostgresPort({});
const serverEnv = resolveServerEnv({});
check("resolvePostgresPort() == 服务 DATABASE_URL 的端口", checked, Number(new URL(serverEnv.DATABASE_URL).port));

// ---- 4. 覆盖口子：只认显式传参，**刻意不认 DATABASE_URL** ----
// 这是 2026-09-12 实测出的回归：config 加载 .env.local 后 DATABASE_URL 变成文件里的
// 5432，而 compose 起的库在 5433 → 端口修复当场回归。两个来源语义不同，不能混用。
check(
  "POSTGRES_PORT 显式覆盖优先",
  resolvePostgresPort({ POSTGRES_PORT: "7777", DATABASE_URL: "postgresql://u:p@h:6543/db" }),
  7777,
);
check(
  "DATABASE_URL **不**影响 e2e 目标端口（防回归）",
  resolvePostgresPort({ DATABASE_URL: "postgresql://u:p@h:6543/db" }),
  DEFAULT_POSTGRES_PORT,
);
check(
  "库名仍可从 DATABASE_URL 取（只取库名，不取端口）",
  (await import("./pg-target.mjs")).resolvePostgresDatabase({ DATABASE_URL: "postgresql://u:p@h:6543/mydb" }),
  "mydb",
);

// ---- 5. 文件后端模式不注入连接串 ----
const fileEnv = resolveServerEnv({ E2E_STORE: "file" });
check("E2E_STORE=file 时 SITE_STORE", fileEnv.SITE_STORE, "file");
check("E2E_STORE=file 时 DATABASE_URL 为空", fileEnv.DATABASE_URL, "");
check("E2E_STORE=file 时后端判定", (await import("./pg-target.mjs")).resolveStoreBackend({ E2E_STORE: "file" }), "file");

console.log();
if (failures.length) {
  console.error(`不一致 ${failures.length} 项：${failures.join("；")}`);
  process.exit(1);
}
console.log("全部一致：检查目标 == 服务连接目标 == compose 映射。");
