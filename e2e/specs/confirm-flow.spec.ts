import { test, expect } from "../helpers/fixtures";
import { mockAnalyze, readyIntent } from "../helpers/mock-ai";
import { analyzeAndConfirm, expectNoCrash, snap } from "../helpers/ui";

test.describe("B. 确认页", () => {
  test.beforeEach(async ({ page }) => {
    await mockAnalyze(page);
    await analyzeAndConfirm(page, "工业控制器官网，突出质量和全球交付");
  });

  test("全隐藏与全显示均有清晰状态", async ({ page }) => {
    const toggles = page.locator(".generate-toggle");
    const count = await toggles.count();
    for (let i = 0; i < count; i += 1) await toggles.nth(i).click();
    await expect(toggles.filter({ has: page.locator("strong", { hasText: "已隐藏" }) })).toHaveCount(count);
    await expectNoCrash(page);
    for (let i = 0; i < count; i += 1) await toggles.nth(i).click();
    for (let i = 0; i < count; i += 1) await expect(toggles.nth(i)).toHaveClass(/on/);
  });

  test("切模板后意图摘要不漂移", async ({ page }) => {
    const intentCard = page.locator(".generate-intent-card");
    const expectedFacts = ["工业制造", "工业自动化", "海外企业", "专业"];
    const select = page.locator(".generate-select").first();
    const values = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    if (values.length > 1) await select.selectOption(values[1]);
    for (const fact of expectedFacts) await expect(intentCard).toContainText(fact);
    await expect(page.locator(".generate-template-option.active")).toHaveCount(1);
  });
});

test("工业编辑风格冲突时显示设计协调提示", async ({ page }, testInfo) => {
  await mockAnalyze(page, {
    onMessage: () => readyIntent({ tone: "editorial", industry: "工业自动化与精密制造" }),
  });
  await analyzeAndConfirm(page, "工业自动化企业官网，希望有编辑感");
  await expect(page.locator(".design-coordination-notice")).toContainText("工业行业与编辑字体冲突");
  await snap(page, "design-coordination-notice", testInfo);
});
