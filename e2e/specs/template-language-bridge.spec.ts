import { expect, test } from "@playwright/test";

const templates = ["nextjs-landing", "shadcn-landing2"] as const;

for (const templateId of templates) {
  test(templateId + " keeps localized hero text visible and reports a compatible bridge result", async ({ page }) => {
    const response = await page.goto("/api/templates/" + templateId + "/preview");
    expect(response?.ok()).toBe(true);

    const title = templateId === "nextjs-landing" ? "面向全球客户的可靠工业方案" : "让跨境团队更快交付产品网站";
    const report = await page.evaluate(
      ({ currentTemplateId, localizedTitle }) =>
        new Promise<{ visibleSlots: string[]; missingSlots: string[]; incompatible: boolean }>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("bridge apply timeout")), 10_000);
          const receive = (event: MessageEvent) => {
            if (event.data?.type !== "sitecraft:applied" || event.data?.templateId !== currentTemplateId) return;
            window.clearTimeout(timeout);
            window.removeEventListener("message", receive);
            resolve(event.data);
          };
          window.addEventListener("message", receive);
          window.postMessage(
            {
              type: "sitecraft:content",
              templateId: currentTemplateId,
              locale: "zh",
              variant: "preview",
              expectedTargets: ["heroTitle"],
              draft: {
                revision: 73,
                siteName: { zh: "远航科技", en: "Voyage Technology" },
                content: {
                  hero: {
                    title: { zh: localizedTitle, en: "Reliable solutions for global teams" },
                    subtitle: { zh: "从产品展示到询盘转化，保持信息清晰可信。", en: "Clear product stories built for conversion." },
                    cta: { zh: "查看产品", en: "View products" },
                  },
                },
                products: [],
              },
            },
            "*",
          );
        }),
      { currentTemplateId: templateId, localizedTitle: title },
    );

    expect(report.incompatible).toBe(false);
    expect(report.missingSlots).toEqual([]);
    expect(report.visibleSlots.some((slot) => slot.startsWith("hero.title."))).toBe(true);
    await expect(page.locator("body")).toContainText(title);
  });
}
