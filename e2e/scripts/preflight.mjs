import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { hasRequiredPreflightFailure } from "./preflight-result.mjs";

const root = path.resolve(import.meta.dirname, "../..");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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

const checks = {
  envLocal: await exists(path.join(root, ".env.local")),
  nodeModules: await exists(path.join(root, "node_modules")),
  playwright: await exists(path.join(root, "node_modules", "@playwright", "test")),
  chromiumCache: await exists(path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")),
  postgres: await portOpen(5432),
  testServerPortOccupied: await portOpen(Number(process.env.TEST_PORT ?? 3210)),
};

console.log(JSON.stringify(checks));
if (checks.testServerPortOccupied) {
  console.error("test server port is occupied; stop the existing process before Playwright acceptance");
}
if (hasRequiredPreflightFailure(checks)) process.exitCode = 2;
