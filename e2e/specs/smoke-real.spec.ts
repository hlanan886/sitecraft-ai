import { test, expect } from "../helpers/fixtures";
import { snap } from "../helpers/ui";

test("@real 真实 DeepSeek 从一句话生成到工作台", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_REAL_AI !== "1", "仅由 npm run test:e2e:real 显式启用");
  test.setTimeout(180_000);
  await page.goto("/generate");
  await page.locator(".generate-textarea").first().fill("为一家出口欧洲的工业传感器企业做官网，专业可靠，突出质量和交付");
  await page.locator(".generate-input .primary-button").click();
  await expect(page.locator(".generate-confirm")).toBeVisible({ timeout: 60_000 });
  await snap(page, "real-confirm", testInfo);
  await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();
  await expect(page).toHaveURL(/\/workspace\?siteId=/, { timeout: 120_000 });
  const input = page.locator(".chat-input textarea");
  await expect(input).not.toHaveAttribute("placeholder", /正在识别/, { timeout: 30_000 });
  await input.fill("把主标题改得更聚焦工业传感器，不要虚构数据");
  await page.locator(".chat-input button").click();
  await expect(page.getByText(/草稿 v\d+ 已保存|修改已应用/).last()).toBeVisible({ timeout: 90_000 });
  await snap(page, "real-workspace", testInfo);
});
