import { expect, test } from "@playwright/test";

function sseBody(events: Array<Record<string, unknown>>) {
  return events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
}

test("partial generation retries only missing sections and clears the persistent checklist", async ({ page }) => {
  let recoveryBody: Record<string, unknown> | undefined;
  await page.route("**/api/sites/*/generate", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.step === "analyze") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody([{
          type: "done",
          status: "ready",
          siteLanguage: "zh",
          intent: {
            status: "ready",
            businessType: "manufacturing",
            companyName: "恒准工业",
            industry: "工业紧固件",
            targetAudience: "overseasB2b",
            tone: "professional",
            coreSections: ["about", "products", "contact"],
            recommendedTemplateId: "forge",
            summary: "面向海外采购经理的工业官网",
          },
          template: { id: "forge", name: "SMALL BIS", category: "制造业", reason: "匹配工业业务" },
          hiddenSections: [],
        }]),
      });
      return;
    }

    if (body.regenerateMissing) {
      recoveryBody = body;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody([{
          type: "done",
          status: "applied",
          partial: false,
          missingSections: [],
          coverage: {
            filledTargets: ["hero.title"],
            aiFilledTargets: ["about.body", "products"],
            pendingTargets: [],
            residualDemoSlots: [],
            unmappedRequiredTargets: [],
          },
          draft: { revision: 3 },
        }]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody([{
        type: "done",
        status: "applied",
        partial: true,
        missingSections: ["about", "products"],
        coverage: {
          filledTargets: ["hero.title"],
          aiFilledTargets: ["contact.body"],
          pendingTargets: ["about.body", "products"],
          residualDemoSlots: [],
          unmappedRequiredTargets: [],
        },
        draft: { revision: 2 },
      }]),
    });
  });

  await page.goto("/generate");
  await page.locator(".generate-textarea").first().fill("工业紧固件官网，面向海外采购经理");
  await page.locator(".generate-input .primary-button").click();
  await expect(page.locator(".generate-confirm")).toBeVisible();
  await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();

  await expect(page.locator(".generate-terminal-panel")).toContainText("关于");
  await expect(page.locator(".generate-terminal-panel")).toContainText("产品");
  await page.getByRole("button", { name: "仅补全缺失板块" }).click();

  await expect.poll(() => recoveryBody).toBeTruthy();
  expect(recoveryBody?.regenerateMissing).toEqual({ sections: ["about", "products"] });
  await expect(page.locator(".generate-terminal-panel").getByText("缺失板块已补全", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仅补全缺失板块" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "进入工作台查看" })).toBeVisible();
});
