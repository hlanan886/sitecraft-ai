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

  test("相同主模板会根据业务语义分散备选模板", async ({ page }) => {
    await mockAnalyze(page, {
      onMessage: (message) => readyIntent({
        recommendedTemplateId: "forge",
        businessType: message.includes("律师") ? "services" : "manufacturing",
        industry: message.includes("律师") ? "跨境法律服务" : "工业紧固件制造",
        tone: message.includes("律师") ? "editorial" : "technical",
        summary: message,
      }),
    });

    await analyzeAndConfirm(page, "工业紧固件制造商，面向海外采购经理");
    const manufacturing = await page.locator("[data-template-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-template-card")));

    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("跨境律师事务所，面向出海企业");
    await page.locator(".generate-input .primary-button").click();
    await expect(page.locator(".generate-confirm")).toBeVisible();
    const legal = await page.locator("[data-template-card]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-template-card")));

    expect(legal).not.toEqual(manufacturing);
    expect(legal[0]).toBe("forge");
    expect(manufacturing[0]).toBe("forge");
  });

  test("FAQ 请求自动合并到联系板块而不是显示能力拒绝", async ({ page }) => {
    await mockAnalyze(page, {
      onMessage: () => readyIntent({
        coreSections: ["about", "products", "contact"],
        limits: ["不支持独立常见问题板块，可在联系页或产品页中以折叠文本形式嵌入常见问题，或改用询盘表单替代"],
      }),
    });
    await analyzeAndConfirm(page, "工业紧固件英文官网，需要常见问题和询盘表单");
    await expect(page.getByText(/已自动把常见问题合并到联系板块/)).toBeVisible();
    await expect(page.getByText(/^不支持独立常见问题板块/)).toHaveCount(0);
  });

  test("新标签展示已填内容预览而不是模板默认占位", async ({ page }) => {
    await mockAnalyze(page, { onMessage: () => readyIntent({ companyName: "东莞恒准紧固件", industry: "工业紧固件制造" }) });
    await analyzeAndConfirm(page, "东莞恒准紧固件英文官网，面向海外采购经理");

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: /查看已填内容预览/ }).click();
    const popup = await popupPromise;
    await expect(popup.getByText("已填内容预览", { exact: true })).toBeVisible();
    await expect(popup.frameLocator("iframe").getByText("东莞恒准紧固件", { exact: true }).first()).toBeVisible();
  });

  test("生成在 30/55 秒分级提示且永不关闭的响应到 120 秒才进入终态", async ({ page }) => {
    await page.clock.install();
    await mockAnalyze(page);
    await mockExecute(page);
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        let body: { step?: string } | undefined;
        try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
        if (/\/api\/sites\/[^/]+\/generate$/.test(url) && body?.step === "execute") {
          return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }
        return nativeFetch(input, init);
      };
    });

    await page.goto("/generate");
    await page.locator(".generate-textarea").first().fill("工业紧固件官网，突出可靠交付");
    await expect(page.locator(".generate-textarea").first()).toHaveValue("工业紧固件官网，突出可靠交付");
    await expect(page.locator(".generate-char-count").first()).toHaveText("14/400");
    await page.locator(".generate-input .primary-button").click();
    await expect(page.locator(".generate-confirm")).toBeVisible();
    await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();
    await expect(page.getByRole("progressbar", { name: "建站进度" })).toBeVisible();
    await page.clock.fastForward(30_500);
    await expect(page.getByText(/响应较慢，仍在生成/)).toBeVisible();
    await expect(page.locator(".generate-confirm")).not.toBeVisible();
    await page.clock.fastForward(25_000);
    await expect(page.getByText(/延长处理/)).toBeVisible();
    await expect(page.locator(".generate-confirm")).not.toBeVisible();
    await page.clock.fastForward(65_000);
    await expect(page.locator(".generate-error")).toContainText("120 秒");
    await expect(page.locator(".generate-confirm")).toBeVisible();
  });

  test("收到 done 后即使 SSE 不关闭也立即完成生成", async ({ page }) => {
    await mockAnalyze(page);
    await mockExecute(page);
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        let body: { step?: string } | undefined;
        try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
        if (/\/api\/sites\/[^/]+\/generate$/.test(url) && body?.step === "execute") {
          const encoder = new TextEncoder();
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", status: "applied", partial: false, missingSections: [] })}\n\n`));
            },
          }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }
        return nativeFetch(input, init);
      };
    });

    await analyzeAndConfirm(page, "工业紧固件官网，突出可靠交付");
    await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();

    await expect(page).toHaveURL(/\/workspace\?siteId=.*generated=1/, { timeout: 5_000 });
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
    /**
     * ⚠️ **必须轮询，不能即时读**（2026-09-13 实测：本用例约 80% 概率假红）。
     *
     * 时序（`app/generate/page.tsx`）：
     * ```
     * :555  setProgressText("正在…生成内容…")   ← UI 先进入"生成中"（上面那句断言此刻成立）
     * :560  await fetch POST /api/sites        ← 真实的建站请求
     * :580  sessionStorage.setItem(ACTIVE_KEY) ← 拿到 siteId 之后才写
     * ```
     * "生成中"文案出现的时刻**早于** key 被写入。机器一忙建站请求就慢，
     * 即时读到的还是 `null` → 假红。
     *
     * 应用本身**没有错**：它不可能在站点还没建出来之前就把 id 写进去。
     * 错的是测试把"某个中间态"当成了"可以立刻断言的不变量"。
     * 所以用 `expect.poll` 等它出现——**不是加固定 sleep**（那只是把窗口挪走，
     * 机器更慢时照样红），而是等一个**真的会到来的事实**。
     */
    const readPendingSiteId = () =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem("sitecraft:active-generation:v1") ?? "null")?.siteId as string | undefined,
      );
    await expect
      .poll(readPendingSiteId, { message: "生成开始后应当把在建站点写进 sessionStorage（等它出现，不是要求它此刻已在）" })
      .toBeTruthy();
    const pendingSiteId = await readPendingSiteId();
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
      await expect(page.getByRole("button", { name: "进入工作台继续补全" })).toBeVisible();
      await expect(page.getByRole("button", { name: "仅补全缺失板块" })).toBeVisible();
      await page.waitForTimeout(4_500);
      await expect(page).toHaveURL(/\/generate$/);
      await expect(page.locator(".generate-section-progress .failed").first()).toContainText("关于");
      await expect(page.locator(".generate-building-grid .failed")).toHaveCount(1);
      await expect(page.locator(".generate-section-progress .failed small").first()).toHaveText("稍后补全");
      await expect(page.locator(".generate-progress-view")).toBeVisible();
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(horizontalOverflow).toBe(false);
      await snap(page, `generation-partial-${viewport.name}`, testInfo);
      await expectNoCrash(page);
    });
  }
});
