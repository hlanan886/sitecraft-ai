import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function analyzeAndConfirm(page: Page, message: string, options: { mayClarify?: boolean } = {}) {
  await page.goto("/generate");
  await page.locator(".generate-textarea").first().fill(message);
  await page.locator(".generate-input .primary-button").click();
  if (options.mayClarify && await page.locator(".generate-clarify-list").isVisible()) {
    await page.locator(".generate-textarea").first().fill("主要面向欧洲制造企业，突出交付能力");
    await page.getByRole("button", { name: /继续理解/ }).click();
  }
  await expect(page.locator(".generate-confirm")).toBeVisible();
}

export async function waitForStep(page: Page, text: string) {
  await expect(page.locator(".eyebrow")).toContainText(text);
}

export async function expectNoCrash(page: Page) {
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
}

export function watchPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function snap(page: Page, name: string, testInfo: TestInfo) {
  const directory = path.join(process.cwd(), "test-results", "steps");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}
