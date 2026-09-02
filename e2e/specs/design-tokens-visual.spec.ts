import type { DesignTokens } from "../../lib/site-document";
import { coordinateDesignTokens } from "../../lib/design-variants";
import { getDraft, putManualOps } from "../helpers/api";
import { test, expect } from "../helpers/fixtures";
import { snap } from "../helpers/ui";

const fallback: DesignTokens = {
  primary: "#1f5a43",
  secondary: "#e8f1eb",
  accent: "#d7ef72",
  fontStyle: "sans",
  radius: "soft",
  density: "balanced",
};

const variants: Array<{
  name: string;
  input: DesignTokens;
  context: { tone: string; industry?: string; fallback: DesignTokens };
}> = [
  {
    name: "tokens-coordinated",
    input: fallback,
    context: { tone: "professional", fallback },
  },
  {
    name: "tokens-color-clash-fallback",
    input: { ...fallback, primary: "#445566", accent: "#465768" },
    context: { tone: "professional", fallback },
  },
  {
    name: "tokens-semantic-conflict-fallback",
    input: { ...fallback, fontStyle: "editorial", density: "spacious" },
    context: { tone: "technical", industry: "工业自动化与精密制造", fallback },
  },
];

for (const variant of variants) {
  test(`设计变量视觉验收：${variant.name}`, async ({ page, request, demoSite }, testInfo) => {
    const coordinated = coordinateDesignTokens(variant.input, variant.context);
    const snapshot = await getDraft(request, demoSite.id);
    await putManualOps(request, demoSite.id, snapshot.draft.revision, [
      { op: "set_design_tokens", tokens: coordinated.tokens },
    ]);
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await expect(page.locator(".workspace-preview").or(page.locator(".rendered-site")).first()).toBeVisible();
    await snap(page, variant.name, testInfo);
  });
}

test("工作台工具栏命令保持单行可读", async ({ page, demoSite }) => {
  await page.goto(`/workspace?siteId=${demoSite.id}`);
  const commands = page.locator(".preview-toolbar-right button, .preview-toolbar-right a");
  await expect(commands.first()).toBeVisible();
  const whiteSpaceValues = await commands.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).whiteSpace));
  expect(whiteSpaceValues.length).toBeGreaterThan(2);
  expect(whiteSpaceValues.every((value) => value === "nowrap")).toBe(true);
});
