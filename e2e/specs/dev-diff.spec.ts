import { test } from "@playwright/test";
// 用 dev 模式行为模拟: 直接请求 preview 看返回的是 local 快照还是上游
test("diag preview source header under dev-like", async ({ request }) => {
  const r = await request.get("/api/templates/astro-starter/preview");
  console.log("[diag] source header:", r.headers()["x-sitecraft-preview-source"], "| status:", r.status());
  const html = await r.text();
  console.log("[diag] has base rewrite:", html.includes('base href="/api/templates/astro-starter/assets/'));
  console.log("[diag] _astro 引用数(应重写为 assets 前缀):", (html.match(/api\/templates\/astro-starter\/assets\/_astro/g) || []).length);
  console.log("[diag] 裸 /_astro 引用数(未重写):", (html.match(/(?:src|href)="\/_astro/g) || []).length);
});
