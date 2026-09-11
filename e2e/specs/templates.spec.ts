import { test, expect } from "../helpers/fixtures";
import { expectNoCrash } from "../helpers/ui";
import { templates } from "../../lib/site-model";

test.describe("D. 模板选择", () => {
  const counts = new Map([
    ["全部模板", templates.length],
    ...["制造业", "外贸目录", "科技企业", "专业服务"].map((category) => [
      category,
      templates.filter((template) => template.category === category).length,
    ] as [string, number]),
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
    await expect(page.locator(".template-grid .template-card")).toHaveCount(templates.length);
    await expect(page.locator(".template-live-cover iframe.open-source-template-frame")).toHaveCount(templates.length);
    await expect(page.locator(".template-live-badge").first()).toContainText("本地模板预览");
  });
});
