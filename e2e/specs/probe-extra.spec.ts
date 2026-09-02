import { test, expect } from "../helpers/fixtures";

test("产品导入参数自动打开现有导入界面", async ({ page, demoSite }) => {
  await page.goto(`/workspace?siteId=${demoSite.id}&import=products`);
  await expect(page.getByRole("dialog").or(page.locator(".import-modal"))).toBeVisible();
});
