import { expect, test } from "@playwright/test";

test("NEXT LANDING 本地预览不依赖 Next 运行时且关键样式资产可读取", async ({ page, request }) => {
  const preview = await request.get("/api/templates/nextjs-landing/preview");

  expect(preview.status()).toBe(200);
  expect(preview.headers()["x-sitecraft-preview-source"]).toBe("local-open-source-snapshot");

  const html = await preview.text();
  expect(html).not.toMatch(/\/_next\/(?:image|static)\//);

  const baseHref = html.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1];
  const stylesheetHref = html.match(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/i)?.[1];
  expect(baseHref).toBeTruthy();
  expect(stylesheetHref).toBeTruthy();

  const stylesheetUrl = new URL(stylesheetHref!, new URL(baseHref!, preview.url())).toString();
  const stylesheet = await request.get(stylesheetUrl);
  expect(stylesheet.status()).toBe(200);
  expect(stylesheet.headers()["content-type"]).toContain("text/css");
  expect(await stylesheet.text()).toContain(".hero");

  const pageResponse = await page.goto("/api/templates/nextjs-landing/preview");
  expect(pageResponse?.status()).toBe(200);
  await expect(page).toHaveTitle("Next Landing / Corporate");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".hero")).toHaveCSS("display", "grid");

  const screenshot = await page.screenshot({
    path: "test-results/steps/chromium-nextjs-landing-preview.png",
    fullPage: false,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test("NEXT LANDING 真实包装页完整展示 iframe 首屏而不是默认 150px 高度", async ({ page }) => {
  const consoleErrors: Array<{ text: string; url: string }> = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    const url = message.location().url;
    if (message.type() === "error" && url.includes("/api/templates/nextjs-landing/")) {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.frame().url().includes("/api/templates/nextjs-landing/preview")) {
      failedRequests.push(request.url());
    }
  });

  const wrapperResponse = await page.goto("/templates/nextjs-landing/preview");
  expect(wrapperResponse?.status()).toBe(200);

  const frameElement = page.locator('iframe[title="开源模板 nextjs-landing 预览"]');
  await expect(frameElement).toBeVisible();
  const frame = page.frameLocator('iframe[title="开源模板 nextjs-landing 预览"]');
  await expect(frame.locator("h1")).toBeVisible();

  const frameBox = await frameElement.boundingBox();
  const heroBox = await frame.locator(".hero").boundingBox();
  const bodyHeight = await frame.locator("body").evaluate((body) => body.scrollHeight);
  expect(frameBox?.height).toBeGreaterThan(500);
  expect(heroBox?.height).toBeGreaterThan(400);
  expect(bodyHeight).toBeGreaterThan(1_500);
  expect({ consoleErrors, failedRequests }).toEqual({ consoleErrors: [], failedRequests: [] });

  const screenshot = await page.screenshot({
    path: "test-results/steps/chromium-nextjs-landing-wrapper-desktop.png",
    fullPage: false,
  });
  expect(screenshot.byteLength).toBeGreaterThan(20_000);
});

test("NEXT LANDING 移动端包装页完整展示且不会横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const consoleErrors: Array<{ text: string; url: string }> = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    const url = message.location().url;
    if (message.type() === "error" && url.includes("/api/templates/nextjs-landing/")) {
      consoleErrors.push({ text: message.text(), url });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.frame().url().includes("/api/templates/nextjs-landing/preview")) {
      failedRequests.push(request.url());
    }
  });

  const wrapperResponse = await page.goto("/templates/nextjs-landing/preview");
  expect(wrapperResponse?.status()).toBe(200);

  const frameElement = page.locator('iframe[title="开源模板 nextjs-landing 预览"]');
  await expect(frameElement).toBeVisible();
  const frame = page.frameLocator('iframe[title="开源模板 nextjs-landing 预览"]');
  await expect(frame.locator("h1")).toBeVisible();

  const frameBox = await frameElement.boundingBox();
  const heroBox = await frame.locator(".hero").boundingBox();
  const frameDocumentSize = await frame.locator("html").evaluate((html) => ({
    clientWidth: html.clientWidth,
    scrollWidth: html.scrollWidth,
    scrollHeight: html.scrollHeight,
  }));
  const wrapperDocumentSize = await page.locator("html").evaluate((html) => ({
    clientWidth: html.clientWidth,
    scrollWidth: html.scrollWidth,
  }));

  expect(frameBox?.x).toBeGreaterThanOrEqual(0);
  expect((frameBox?.x ?? 0) + (frameBox?.width ?? 0)).toBeLessThanOrEqual(391);
  expect(frameBox?.height).toBeGreaterThan(500);
  expect(heroBox?.height).toBeGreaterThan(400);
  expect(frameDocumentSize.scrollHeight).toBeGreaterThan(1_500);
  expect(frameDocumentSize.scrollWidth).toBeLessThanOrEqual(frameDocumentSize.clientWidth + 1);
  expect(wrapperDocumentSize.scrollWidth).toBeLessThanOrEqual(wrapperDocumentSize.clientWidth + 1);
  expect({ consoleErrors, failedRequests }).toEqual({ consoleErrors: [], failedRequests: [] });

  const screenshot = await page.screenshot({
    path: "test-results/steps/chromium-nextjs-landing-wrapper-mobile.png",
    fullPage: false,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});
