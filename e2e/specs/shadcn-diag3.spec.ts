import { test } from "@playwright/test";

test("diag iframe body first 500", async ({ page }) => {
  await page.goto("/templates/shadcn-landing2/preview");
  await page.waitForTimeout(4500);
  const f = page.frames().find((fr) => fr !== page.mainFrame())!;
  const body = await f.evaluate(() => document.body?.innerHTML.slice(0, 800) ?? "(no body)");
  console.log("[diag] iframe body 800:", body.slice(0, 800));
  const topBody = await page.evaluate(() => document.body?.innerHTML.slice(0, 200) ?? "");
  console.log("[diag] top body 200:", topBody.slice(0, 200));
});
