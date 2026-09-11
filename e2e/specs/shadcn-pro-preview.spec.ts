import { expect, test } from "@playwright/test";

const shadcnAssetPrefix = "/api/templates/shadcn-landing2/assets/";

function isTrackedStaticAsset(requestUrl: string) {
  const { pathname } = new URL(requestUrl);
  return pathname.startsWith(shadcnAssetPrefix) || pathname.startsWith("/_next/static/");
}

test("SHADCN PRO wrapper applies its exported styles inside the preview iframe", async ({ page, request }, testInfo) => {
  const failedAssets: Array<{ url: string; status?: number; error?: string }> = [];

  page.on("requestfailed", (request) => {
    if (isTrackedStaticAsset(request.url())) {
      failedAssets.push({ url: request.url(), error: request.failure()?.errorText });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && isTrackedStaticAsset(response.url())) {
      failedAssets.push({ url: response.url(), status: response.status() });
    }
  });

  const previewResponse = await request.get("/api/templates/shadcn-landing2/preview");
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()["x-sitecraft-preview-source"]).toBe("local-open-source-snapshot");
  const previewHtml = await previewResponse.text();
  expect(previewHtml).not.toMatch(/(?:src|href)=["']\/_next\//i);

  const cssUrl = previewHtml.match(/<link\b[^>]*href=["']([^"']+\.css)["']/i)?.[1];
  const scriptUrl = previewHtml.match(/<script\b[^>]*src=["']([^"']+\.js)["']/i)?.[1];
  const heroUrl = previewHtml.match(/<img\b[^>]*src=["']([^"']*hero-image[^"']+)["']/i)?.[1];
  expect(cssUrl).toBeTruthy();
  expect(scriptUrl).toBeTruthy();
  expect(heroUrl).toBeTruthy();

  for (const [assetUrl, contentType] of [
    [cssUrl!, "text/css"],
    [scriptUrl!, "text/javascript"],
    [heroUrl!, "image/jpeg"],
  ] as const) {
    const assetResponse = await request.get(assetUrl);
    expect(assetResponse.status(), assetUrl).toBe(200);
    expect(assetResponse.headers()["content-type"], assetUrl).toContain(contentType);
  }

  const response = await page.goto("/templates/shadcn-landing2/preview");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".template-preview-toolbar-title strong")).toHaveText("SHADCN PRO / Modern");

  const previewFrame = page.frameLocator('iframe[title="开源模板 shadcn-landing2 预览"]');
  const previewFrameElement = page.locator('iframe[title="开源模板 shadcn-landing2 预览"]');
  await expect(previewFrame.locator("body")).toBeVisible();

  const renderState = await previewFrame.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const heroHeading = doc.querySelector<HTMLElement>("h1");
    const hero = heroHeading?.closest<HTMLElement>("section") ?? null;
    const heroLayout = hero?.querySelector<HTMLElement>(".grid") ?? null;
    const styleSheets = [...doc.styleSheets].map((sheet) => {
      let ruleCount = -1;
      try {
        ruleCount = sheet.cssRules.length;
      } catch {
        // Cross-origin styles are represented explicitly instead of hiding the failure.
      }
      return { href: sheet.href, ruleCount };
    });

    return {
      styleSheets,
      bodyFont: getComputedStyle(body).fontFamily,
      heroDisplay: heroLayout ? getComputedStyle(heroLayout).display : null,
      heroHeight: hero?.getBoundingClientRect().height ?? 0,
      heroHeading: heroHeading?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    };
  });

  await page.screenshot({
    path: "test-results/steps/chromium-shadcn-pro-wrapper.png",
    fullPage: false,
  });
  const frameScreenshot = await previewFrameElement.screenshot({
    path: "test-results/steps/chromium-shadcn-pro-iframe.png",
  });
  const pixelStats = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled = 0;
    let nonWhite = 0;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      sampled += 1;
      if (red < 245 || green < 245 || blue < 245) nonWhite += 1;
      colors.add(`${red >> 3},${green >> 3},${blue >> 3}`);
    }
    return { nonWhiteRatio: nonWhite / sampled, colorCount: colors.size };
  }, `data:image/png;base64,${frameScreenshot.toString("base64")}`);

  await testInfo.attach("shadcn-pro-render-diagnostics", {
    body: Buffer.from(JSON.stringify({ failedAssets, renderState, pixelStats }, null, 2)),
    contentType: "application/json",
  });

  expect(failedAssets).toEqual([]);
  expect(renderState.styleSheets.some((sheet) => sheet.ruleCount > 0)).toBe(true);
  expect(renderState.bodyFont).not.toMatch(/Times New Roman/i);
  expect(renderState.heroDisplay).toBe("grid");
  expect(renderState.heroHeight).toBeGreaterThan(300);
  expect(renderState.heroHeading).toBeTruthy();
  expect(pixelStats.nonWhiteRatio).toBeGreaterThan(0.2);
  expect(pixelStats.colorCount).toBeGreaterThan(50);
});
