import { expect, test } from "@playwright/test";
import { defaultDraft } from "../../lib/site-document";

test("siteId preview reads the current server revision and ignores a conflicting local snapshot", async ({ page, request }) => {
  const initialDraft = structuredClone(defaultDraft);
  initialDraft.siteName = "Northstar Components";
  initialDraft.companyName = "Northstar Components";
  initialDraft.templateId = "forge";
  initialDraft.locale = "en";
  initialDraft.revision = 7;
  initialDraft.content.hero.title.en = "Server-backed industrial systems";
  initialDraft.content.products.title.en = "Server-backed product line";

  const createResponse = await request.post("/api/sites", {
    data: {
      name: "Northstar Components",
      templateId: "forge",
      locales: ["en"],
      initialDraft,
    },
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as { id: string };

  const conflictingDraft = structuredClone(initialDraft);
  conflictingDraft.revision = 99;
  conflictingDraft.companyName = "Stale Local Company";
  conflictingDraft.content.hero.title.en = "Stale local heading";
  await page.addInitScript(({ draft }) => {
    window.localStorage.setItem("sitecraft:real-preview-draft:v1", JSON.stringify({
      savedAt: Date.now(),
      draft,
    }));
  }, { draft: conflictingDraft });

  await page.goto(`/templates/forge/preview?siteId=${created.id}`);

  await expect(page.getByText("已填内容预览 · v7")).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("heading", {
    name: "Server-backed industrial systems",
  }).first()).toBeVisible();
  await expect(page.frameLocator("iframe").getByText("Stale local heading")).toHaveCount(0);

  const updateResponse = await request.put(`/api/sites/${created.id}/draft`, {
    data: {
      baseRevision: 7,
      operations: [{
        op: "set_text",
        target: "hero.title",
        locale: "en",
        value: "Current revision after refresh",
      }],
      summary: "Refresh source consistency",
      source: "manual",
    },
  });
  expect(updateResponse.ok()).toBe(true);

  await page.reload();
  await expect(page.getByText("已填内容预览 · v8")).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("heading", {
    name: "Current revision after refresh",
  }).first()).toBeVisible();
});
