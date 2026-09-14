#!/usr/bin/env node
/** 渲染后 DOM 结构 dump（写 adapter 用）。用法：node --experimental-strip-types scripts/dump-dom.mjs <templateId> */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import net from "node:net";

const root = path.resolve(import.meta.dirname, "..");
const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
const templateId = process.argv[2] || "shadcn-landing";

function waitPort(port, timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(800);
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.on("timeout", () => { socket.destroy(); retry(); });
      socket.once("error", () => { socket.destroy(); retry(); });
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error("server_timeout")) : setTimeout(tick, 700));
    tick();
  });
}

const server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await waitPort(PORT);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/api/templates/${templateId}/preview`);
  await page.waitForTimeout(5000); // 等 React 渲染

  const dump = await page.evaluate(() => {
    const lines = [];
    const walk = (node, depth) => {
      if (depth > 5) return;
      for (const child of node.children) {
        const tag = child.tagName.toLowerCase();
        if (['script', 'style', 'svg', 'path', 'link', 'meta'].includes(tag)) continue;
        const id = child.id ? `#${child.id}` : '';
        const cls = child.className && typeof child.className === 'string' ? `.${child.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
        const own = Array.from(child.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 50);
        const r = child.getBoundingClientRect();
        lines.push(`${'  '.repeat(depth)}${tag}${id}${cls}${own ? `  «${own}»` : ''}  [${Math.round(r.width)}x${Math.round(r.height)}]`);
        walk(child, depth + 1);
      }
    };
    walk(document.body, 0);
    return lines.join('\n');
  });
  console.log(dump);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 600));
  server.kill("SIGKILL");
}
