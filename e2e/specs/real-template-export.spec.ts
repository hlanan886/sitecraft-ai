import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

for (const templateId of ["forge", "screwfast"] as const) {
  test(templateId + " exports the applied real template as a self-contained offline file", async ({ browser, page }, testInfo) => {
    const siteId = "export-" + templateId;
    const revision = 81;
    const title = templateId === "forge" ? "精密制造，稳定交付" : "Fasteners engineered for global production";
    const response = await page.goto("/api/templates/" + templateId + "/preview");
    expect(response?.ok()).toBe(true);

    const exportResult = await page.evaluate(
      ({ currentTemplateId, currentSiteId, currentRevision, localizedTitle }) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("real template export timeout")), 30_000);
          const requestId = "e2e-" + currentTemplateId;
          const receive = (event: MessageEvent) => {
            if (event.data?.type === "sitecraft:applied" && event.data?.revision === currentRevision) {
              window.postMessage({
                type: "sitecraft:export-request",
                requestId,
                templateId: currentTemplateId,
                siteId: currentSiteId,
                revision: currentRevision,
              }, "*");
            }
            if (event.data?.type !== "sitecraft:export-result" || event.data?.requestId !== requestId) return;
            window.clearTimeout(timeout);
            window.removeEventListener("message", receive);
            resolve(event.data);
          };
          window.addEventListener("message", receive);
          window.postMessage({
            type: "sitecraft:content",
            templateId: currentTemplateId,
            siteKey: currentSiteId,
            locale: "zh",
            variant: "published",
            expectedTargets: ["heroTitle"],
            draft: {
              revision: currentRevision,
              siteName: "远航精工",
              companyName: "远航精工",
              content: {
                hero: {
                  title: { zh: localizedTitle, en: localizedTitle },
                  subtitle: { zh: "面向全球客户提供可信赖的工程与交付能力。", en: "Reliable engineering and delivery for global customers." },
                  cta: { zh: "查看产品", en: "View products" },
                },
              },
              products: [],
            },
          }, "*");
        }),
      { currentTemplateId: templateId, currentSiteId: siteId, currentRevision: revision, localizedTitle: title },
    );

    console.log("template export result", templateId, JSON.stringify({
      ok: exportResult.ok,
      error: exportResult.error,
      bytes: exportResult.bytes,
      report: exportResult.report,
    }));
    expect(exportResult.ok).toBe(true);
    expect(exportResult.templateId).toBe(templateId);
    expect(exportResult.siteId).toBe(siteId);
    expect(exportResult.revision).toBe(revision);
    expect(exportResult.bytes).toBeLessThan(10_000_000);
    expect(exportResult.report).toMatchObject({ externalResourceUrls: [] });

    const htmlPath = testInfo.outputPath(templateId + "-offline.html");
    await writeFile(htmlPath, String(exportResult.html), "utf8");
    const offlineContext = await browser.newContext();
    const offlinePage = await offlineContext.newPage();
    const nonNavigationRequests: string[] = [];
    offlinePage.on("request", (request) => {
      if (!request.isNavigationRequest() && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) {
        nonNavigationRequests.push(request.url());
      }
    });
    await offlinePage.goto(pathToFileURL(htmlPath).href);
    await expect(offlinePage.locator("body")).toContainText(title);
    expect(nonNavigationRequests).toEqual([]);
    await offlineContext.close();
  });
}
