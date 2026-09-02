import { test, expect } from "../helpers/fixtures";
import { expectNoCrash } from "../helpers/ui";

test.describe("E. 全局异常", () => {
  test("断网分析显示友好错误并恢复按钮", async ({ page }) => {
    await page.route("**/api/sites/demo/generate", (route) => route.abort("internetdisconnected"));
    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("做一个自动化设备官网");
    const button = page.locator(".generate-input .primary-button");
    await button.click();
    await expect(page.locator(".generate-error")).toBeVisible();
    await expect(button).toBeEnabled();
    await expectNoCrash(page);
  });

  test("提交期间按钮禁用，避免重复请求", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/sites/demo/generate", async (route) => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "测试错误" }) });
    });
    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("工业软件官网");
    const button = page.locator(".generate-input .primary-button");
    await button.click({ noWaitAfter: true });
    await expect(button).toBeDisabled();
    await expect(page.locator(".generate-error")).toBeVisible();
    expect(requests).toBe(1);
  });

  test("首页关键导航均可达", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /模板/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /建站|生成/ }).first()).toBeVisible();
  });
});
