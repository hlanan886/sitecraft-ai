import { expect, test } from "@playwright/test";

const templates = ["nextjs-landing", "shadcn-landing2"] as const;

for (const templateId of templates) {
  test(templateId + " keeps localized hero text visible and reports a compatible bridge result", async ({ page }) => {
    /**
     * ⚠️ **实例级隔离（T-14）：只隔离 `shadcn-landing2` 这一个实例。**
     *
     * 同一根因见 `docs/glossary.md` T-14：生产 CSP 拦该模板的内联脚本 →
     * **间歇**渲染不出内容（复审实测冷加载 **EMPTY 1/20**：19/20 内容完好、
     * 1/20 槽位全空）。CSP 拦截是**必要条件不是充分条件**。
     *
     * **粒度是刻意的**：本文件是 `for` 循环参数化，`nextjs-landing` 那条
     * **不受影响**，它的断言原样保留——整 spec skip 会把好的也一起埋掉。
     *
     * **为什么 skip 而不是 test.fail**：间歇缺陷用 test.fail 会**随机报
     * unexpected pass**，守卫自己变成随机红。替代拉力绳 =
     * `e2e/scripts/probe-empty-rate.mjs`（收编在 `test:e2e:strict`，EMPTY≥1 非零退出）。
     * **禁止用全套 e2e 绿反推 T-14 已修。**
     *
     * **恢复条件 = T-13 修复后先跑探针归零，再摘掉本行。**
     */
    // T-14 已修（2026-09-14）：探针 0/50，水合快照兜底生效，skip 已摘。
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
