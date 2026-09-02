import { test, expect } from "../helpers/fixtures";
import { expectNoCrash } from "../helpers/ui";

test.describe("D. 模板选择", () => {
  const counts = new Map([
    ["全部模板", 16],
    ["制造业", 1],
    ["外贸目录", 2],
    ["科技企业", 6],
    ["专业服务", 7],
  ]);

  test("分类筛选数量正确且快速切换不串状态", async ({ page }) => {
    await page.goto("/templates");
    for (const [label, count] of counts) {
      await page.locator(".template-filters").getByText(label, { exact: true }).click();
      await expect(page.locator(".template-grid .template-card")).toHaveCount(count);
    }
    await expectNoCrash(page);
  });

  test("所有模板卡片使用本地渲染且无空白", async ({ page }) => {
    await page.goto("/templates");
    await expect(page.locator(".template-grid .template-card")).toHaveCount(16);
    await expect(page.locator(".template-live-cover .rendered-site")).toHaveCount(16);
    await expect(page.locator(".template-live-badge").first()).toContainText("本地模板预览");
  });
});
