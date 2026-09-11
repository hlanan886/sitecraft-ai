import type { FullConfig } from "@playwright/test";
import net from "node:net";

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
  if (!await portOpen(5432)) throw new Error("E2E requires Postgres on 127.0.0.1:5432");
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is missing");
  const response = await fetch(baseURL);
  if (!response.ok) throw new Error(`E2E home check failed with ${response.status}`);
}
