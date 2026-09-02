import { test, expect } from "../helpers/fixtures";
import { mockAnalyze, mockExecute, readyIntent, sseBody } from "../helpers/mock-ai";
import { analyzeAndConfirm, expectNoCrash, snap, watchPageErrors } from "../helpers/ui";

test.describe("A. 一句话建站", () => {
  for (const sample of ["", "😀😀😀", "!!!"]) {
    test(`无语义输入 ${JSON.stringify(sample)} 给出友好提示`, async ({ page }) => {
      const pageErrors = watchPageErrors(page);
      await page.goto("/generate");
      const input = page.locator(".generate-textarea").first();
      if (sample) await input.fill(sample);
      const button = page.locator(".generate-input .primary-button");
      if (!sample) {
        await expect(button).toBeDisabled();
      } else {
        await button.click();
        await expect(page.locator(".generate-error")).toContainText("只有表情或符号无法识别");
        await expect(button).toBeEnabled();
      }
      await expect(page).toHaveURL(/\/generate$/);
      expect(pageErrors).toEqual([]);
    });
  }

  test("超过 400 字时明确截断并通过计数告知用户", async ({ page }) => {
    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("工业自动化".repeat(100));
    await expect(page.locator(".generate-textarea").first()).toHaveValue(/^.{400}$/s);
    await expect(page.locator(".generate-char-count").first()).toHaveText("400/400");
    await expectNoCrash(page);
  });

  test("中英混杂和口语化需求可进入确认页", async ({ page }) => {
    await mockAnalyze(page);
    await analyzeAndConfirm(page, "给咱整一个 solar inverter 官网，主要卖 Europe，专业点儿");
  });

  test("模糊需求进入澄清而不是瞎猜", async ({ page }) => {
    await mockAnalyze(page, { onMessage: () => readyIntent({ status: "need_info", needsInfo: ["主要服务谁？"] }) });
    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("做个网站");
    await page.locator(".generate-input .primary-button").click();
    await expect(page.locator(".generate-clarify-list")).toContainText("主要服务谁");
  });

  test("越界请求显示拒绝原因并停留输入页", async ({ page }) => {
    await mockAnalyze(page, { onMessage: () => readyIntent({ status: "rejected", rejectionReason: "该需求超出建站范围。" }) });
    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("帮我写自动抢票脚本");
    await page.locator(".generate-input .primary-button").click();
    await expect(page.locator(".generate-error")).toContainText("超出建站范围");
    await expect(page.locator(".generate-confirm")).toHaveCount(0);
  });

  test("切换模板后板块状态保持独立且预览同步", async ({ page }) => {
    await mockAnalyze(page);
    await analyzeAndConfirm(page, "工业传感器官网，面向欧洲采购商");
    const toggle = page.locator(".generate-toggle").first();
    await toggle.click();
    await expect(toggle).toHaveClass(/off/);
    const select = page.locator(".generate-select").first();
    const options = await select.locator("option").all();
    if (options.length > 1) await select.selectOption(await options[1].getAttribute("value") ?? "");
    await expect(toggle).toHaveClass(/off/);
    await expect(page.locator("[data-template-selection]")).toHaveAttribute("data-template-selection", await select.inputValue());
  });

  test("real-template-preview：推荐模板展示真实模板预览而不是通用换肤渲染", async ({ page }) => {
    await mockAnalyze(page);
    await analyzeAndConfirm(page, "工业传感器官网，面向欧洲采购商");
    const selectedTemplate = await page.locator("[data-template-selection]").getAttribute("data-template-selection");
    expect(selectedTemplate).toBeTruthy();
    const previewFrame = page.locator("[data-template-card].active iframe");
    await expect(previewFrame).toHaveAttribute("src", new RegExp(`/api/templates/${selectedTemplate}/preview`));
    await expect(previewFrame).toHaveAttribute("title", new RegExp("模板"));
  });

  test("推荐模板以三张可滑动卡片展示并同步当前选中模板", async ({ page }) => {
    await mockAnalyze(page);
    await analyzeAndConfirm(page, "工业传感器官网，面向欧洲采购商");
    const carousel = page.locator("[data-template-carousel]");
    await expect(carousel).toBeVisible();
    await expect(carousel.locator("[data-template-card]")).toHaveCount(3);
    const active = carousel.locator("[data-template-card].active");
    await expect(active).toHaveCount(1);
    const before = await active.getAttribute("data-template-card");
    await expect(carousel.getByText("1 / 3", { exact: true })).toBeVisible();
    await carousel.getByRole("button", { name: "下一个推荐模板" }).click();
    await expect(carousel.getByText("2 / 3", { exact: true })).toBeVisible();
    await expect(carousel.locator("[data-template-card].active")).toHaveAttribute("data-template-card", new RegExp(`^(?!${before}$).+`));
    await expect(page.locator("[data-template-selection]")).toHaveAttribute("data-template-selection", await carousel.locator("[data-template-card].active").getAttribute("data-template-card") ?? "");
  });

  test("导入上下文随分析请求发送", async ({ page }) => {
    let requestBody: Record<string, unknown> | undefined;
    await mockAnalyze(page, { onMessage: (_message, body) => { requestBody = body; } });
    await page.goto("/generate");
    await page.locator(".generate-import summary").click();
    await page.locator(".generate-import .generate-textarea").fill("公司成立于 2012 年，主营伺服驱动器");
    await page.locator(".generate-textarea").first().fill("做一个工业官网");
    await page.locator(".generate-input .primary-button").click();
    await expect(page.locator(".generate-confirm")).toBeVisible();
    expect(requestBody?.extraContext).toContain("伺服驱动器");
  });

  test("快速连点生成只创建一个站点并执行一次", async ({ page }) => {
    let creates = 0;
    let executes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/sites") creates += 1;
    });
    await mockAnalyze(page);
    await mockExecute(page, () => { executes += 1; });
    await analyzeAndConfirm(page, "工业软件官网，面向全球制造企业");
    const button = page.getByRole("button", { name: /用此模板生成站点内容/ });
    await button.click({ clickCount: 3 });
    await expect(page).toHaveURL(/\/workspace\?siteId=/);
    expect(creates).toBe(1);
    expect(executes).toBe(1);
  });

  test("生成中刷新保留原始需求", async ({ page }) => {
    const message = "工业传感器官网，面向欧洲采购商，突出可靠交付";
    await mockAnalyze(page);
    await page.route("**/api/sites/*/generate", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.step === "analyze") return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody([{ type: "done", status: "applied" }]) });
    });
    await analyzeAndConfirm(page, message);
    await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();
    await expect(page.getByText("AI 正在填充内容", { exact: false })).toBeVisible();
    const pendingSiteId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("sitecraft:active-generation:v1") ?? "null")?.siteId as string | undefined);
    expect(pendingSiteId).toBeTruthy();
    await page.reload();
    await expect(page.locator(".generate-textarea").first()).toHaveValue(message);
    await expect(page.locator(".generate-error")).toContainText("已保留原站点");
    const restoredSiteId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("sitecraft:active-generation:v1") ?? "null")?.siteId as string | undefined);
    expect(restoredSiteId).toBe(pendingSiteId);
    await expectNoCrash(page);
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`生成板块在 ${viewport.name} 显示真实恢复与失败状态`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockAnalyze(page);
      await page.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          let body: { step?: string } | undefined;
          try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
          if (/\/api\/sites\/[^/]+\/generate$/.test(url) && body?.step === "execute") {
            const encoder = new TextEncoder();
            const event = (value: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
            return new Response(new ReadableStream({
              start(controller) {
                controller.enqueue(event({ type: "status", value: "首屏已完成，正在恢复其他板块", phase: "content", completedSections: ["hero"], activeSections: ["products", "contact"], recoveringSections: ["about", "features", "services"], failedSections: [] }));
                window.setTimeout(() => controller.enqueue(event({ type: "status", value: "关于板块暂未完成，其他内容继续保存", phase: "content", completedSections: ["hero", "features", "services"], activeSections: ["products", "contact"], recoveringSections: [], failedSections: ["about"] })), 500);
                window.setTimeout(() => {
                  controller.enqueue(event({ type: "status", value: "正在保存已完成内容", phase: "saving", completedSections: ["hero", "features", "services", "products", "contact"], activeSections: [], recoveringSections: [], failedSections: ["about"] }));
                  controller.enqueue(event({ type: "done", status: "applied", partial: true, missingSections: ["about"] }));
                  controller.close();
                }, 2_000);
              },
            }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
          }
          return nativeFetch(input, init);
        };
      });

      await analyzeAndConfirm(page, "工业传感器官网，突出可靠交付");
      await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();
      await expect(page.locator(".generate-section-progress .recovering")).toHaveCount(3);
      await expect(page.locator(".generate-building-grid .recovering")).toHaveCount(3);
      await expect(page.locator(".generate-section-progress .done")).toContainText(["首屏"]);
      await snap(page, `generation-recovering-${viewport.name}`, testInfo);
      await expect(page.locator(".generate-section-progress .failed")).toContainText("关于");
      await expect(page.locator(".generate-building-grid .failed")).toHaveCount(1);
      await expect(page.locator(".generate-section-progress .failed small")).toHaveText("稍后补全");
      await expect(page.locator(".generate-progress-view")).toBeVisible();
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(horizontalOverflow).toBe(false);
      await snap(page, `generation-partial-${viewport.name}`, testInfo);
      await expectNoCrash(page);
    });
  }
});
