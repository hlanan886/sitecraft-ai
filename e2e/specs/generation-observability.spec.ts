import { test, expect } from "../helpers/fixtures";
import { readyIntent } from "../helpers/mock-ai";
import { expectNoCrash, snap } from "../helpers/ui";

test.describe("AI 建站运行观测", () => {
  test("一次冲突生成只记录一个结构化终态", async ({ page }) => {
    const create = await page.request.post("/api/sites", {
      data: { name: "观测测试站点", templateId: "forge", locales: ["zh", "en"] },
    });
    expect(create.ok()).toBe(true);
    const site = await create.json() as { id: string };
    const response = await page.request.post(`/api/sites/${site.id}/generate`, {
      data: {
        step: "execute",
        message: "做一个工业自动化企业官网",
        intent: readyIntent(),
        templateId: "forge",
        siteLanguage: "zh",
        hiddenSections: [],
        baseRevision: 999,
      },
    });
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('"status":"conflict"');

    let matching: Array<Record<string, unknown>> = [];
    await expect.poll(async () => {
      const recordsResponse = await page.request.get("/api/generation-records?limit=200");
      const payload = await recordsResponse.json() as { records: Array<Record<string, unknown>> };
      matching = payload.records.filter((record) => record.siteId === site.id);
      return matching.length;
    }).toBe(1);
    expect(matching[0]).toMatchObject({
      outcome: "conflict",
      mode: "full",
      requestedTemplateId: "forge",
      appliedTemplateId: "forge",
      errorCode: "revision_conflict",
    });
  });

  test("运行质量面板在桌面与移动端稳定展示明确口径", async ({ page }, testInfo) => {
    await page.route("**/api/generation-records?limit=200", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        enabled: true,
        metrics: {
          sampleSize: 20,
          delivered: 18,
          deliveryRate: 0.9,
          partialRate: 0.1,
          templateFallbackRate: 0.05,
          failureRate: 0.1,
          timeoutRate: 0.05,
          p50LatencyMs: 2800,
          p95LatencyMs: 9500,
        },
      }),
    }));

    for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/settings");
      await expect(page.locator(".generation-metric")).toHaveCount(6);
      await expect(page.locator(".generation-health")).toContainText("90%");
      await expect(page.locator(".generation-health")).toContainText("9.5s");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expectNoCrash(page);
      await snap(page, `generation-health-${viewport.name}`, testInfo);
    }
  });
});
