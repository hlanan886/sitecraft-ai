import type { FullConfig } from "@playwright/test";
import net from "node:net";
// 端口与后端从**单一来源**取（e2e/scripts/pg-target.mjs）。
// 此前这里硬编码 5432，与 compose 的 5433 映射不一致，e2e 直接起不来。
import { resolvePostgresPort, resolveStoreBackend } from "./scripts/pg-target.mjs";

function portOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

export default async function globalSetup(config: FullConfig) {
  // 检查的是**宿主机映射端口**（缺省 5433，见 pg-target.mjs），不是容器内 5432。
  if (resolveStoreBackend() === "file") {
    console.log("[e2e] 存储后端：file（E2E_STORE=file，不检查 Postgres）");
  } else {
    const port = resolvePostgresPort();
    if (!await portOpen(port)) {
      throw new Error(`E2E requires Postgres on 127.0.0.1:${port}（容器内端口是 5432，检查宿主机映射端口）`);
    }
  }
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is missing");
  const response = await fetch(baseURL);
  if (!response.ok) throw new Error(`E2E home check failed with ${response.status}`);
}
