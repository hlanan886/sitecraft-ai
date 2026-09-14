import { test } from "@playwright/test";

test("diag: same URL top-level vs iframe render diff", async ({ page }) => {
  // 顶层直访
  await page.goto("/api/templates/shadcn-landing2/preview");
  await page.waitForTimeout(3000);
  const top = await page.evaluate(() => ({ h1: document.querySelectorAll("h1").length, sections: document.querySelectorAll("section").length }));
  console.log("[diag] top-level:", JSON.stringify(top));
  // iframe 内嵌
  await page.setContent('<iframe src="/api/templates/shadcn-landing2/preview"></iframe>');
  await page.waitForTimeout(4000);
  const f = page.frameLocator("iframe");
  const inner = await f.locator("html").evaluate(() => ({ h1: document.querySelectorAll("h1").length, sections: document.querySelectorAll("section").length })).catch(e => ({ err: String(e).slice(0,120) }));
  console.log("[diag] iframe-embedded:", JSON.stringify(inner));
});
