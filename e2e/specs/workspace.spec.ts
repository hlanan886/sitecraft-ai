import { test, expect } from "../helpers/fixtures";
import { getDraft, putManualOps } from "../helpers/api";
import { mockChat, sseBody } from "../helpers/mock-ai";
import { expectNoCrash, snap, watchPageErrors } from "../helpers/ui";
import { templates } from "../../lib/site-model";
import { commitOperations } from "../../lib/site-store";

test.describe("C. 工作台", () => {
  test("生成完成引导可见且可关闭", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}&generated=1`);
    const guide = page.locator(".generate-guide-note");
    await expect(guide).toBeVisible();
    await guide.locator(".generate-guide-close").click();
    await expect(guide).toHaveCount(0);
  });

  test("真实历史支持撤销与重做，按钮状态同步", async ({ page, request, demoSite }) => {
    let snapshot = await getDraft(request, demoSite.id);
    for (const value of ["第一版企业名", "第二版企业名", "第三版企业名"]) {
      await putManualOps(request, demoSite.id, snapshot.draft.revision, [{ op: "set_text", target: "companyName", locale: "zh", value }]);
      snapshot = await getDraft(request, demoSite.id);
    }
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const undo = page.getByRole("button", { name: /撤销/ });
    const redo = page.getByRole("button", { name: /重做/ });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(undo).toBeEnabled();
  });

  test("iframe 预览失败时页面不白屏且无崩溃（不降级为本地近似渲染）", async ({ page, demoSite }) => {
    const pageErrors = watchPageErrors(page);
    await page.route("**/api/templates/*/preview**", (route) => route.abort("failed"));
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    // 产品决策：工作台始终显示真实模板 iframe，不降级为本地结构近似渲染(SiteRenderer)。
    // 预览失败时保持主界面可用、无 JS 崩溃，iframe 由组件重试恢复。
    await expect(page.locator(".preview-toolbar")).toBeVisible();
    await expect(page.locator(".chat-input textarea")).toBeVisible();
    await expectNoCrash(page);
    expect(pageErrors).toEqual([]);
  });

  test("真实模板 iframe 允许同源 bridge 加载静态资源", async ({ page, demoSite }) => {
    await page.route("**/api/templates/*/preview**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><main><h1>同源模板预览</h1></main></body></html>",
      });
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const frame = page.locator("iframe.open-source-template-frame").first();
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", /allow-same-origin/);
  });

  test("同一槽位连续修改 5 次保持草稿与预览状态一致", async ({ page, request, demoSite }) => {
    let version = 0;
    await mockChat(page, demoSite.id, {
      operations: () => [{ op: "set_text", target: "hero.title", locale: "zh", value: `第 ${++version} 版工业标题` }],
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    const appliedChanges = page.locator(".change-summary.applied");
    const preview = page.frameLocator("iframe");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    for (let i = 1; i <= 5; i += 1) {
      await input.fill(`第 ${i} 次修改主标题`);
      await input.press("Enter");
      await expect(appliedChanges).toHaveCount(i);
      await expect(preview.getByRole("heading", { level: 1, name: `第 ${i} 版工业标题` })).toBeVisible();
    }
    const snapshot = await getDraft(request, demoSite.id);
    const content = snapshot.draft.content as { hero: { title: { zh: string } } };
    expect(content.hero.title.zh).toBe("第 5 版工业标题");
  });

  test("AI 修改后消息展示字段级前后差异", async ({ page, demoSite }, testInfo) => {
    await mockChat(page, demoSite.id, {
      operations: () => [{ op: "set_text", target: "hero.title", locale: "zh", value: "面向全球工业客户的可靠方案" }],
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("把首屏标题改成面向全球工业客户的可靠方案");
    await input.press("Enter");

    const diff = page.locator(".change-diff").last();
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("首屏标题（中文）");
    await expect(diff).toContainText("为下一代标准而造。");
    await expect(diff).toContainText("面向全球工业客户的可靠方案");
    await snap(page, "workspace-change-diff-desktop", testInfo);
  });

  test("AI 对话进行中可以主动取消且草稿不变", async ({ page, request, demoSite }) => {
    let releaseRequest!: () => void;
    const stalled = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route(`**/api/sites/${demoSite.id}/chat`, async (route) => {
      await stalled;
      await route.abort("aborted").catch(() => undefined);
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    const before = await getDraft(request, demoSite.id);
    await input.fill("请重写首屏标题，但暂时不要修改其他内容");
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "取消 AI 请求" })).toBeVisible();
    await page.getByRole("button", { name: "取消 AI 请求" }).click();
    await expect(page.getByText("已取消 AI 修改", { exact: false })).toBeVisible();
    releaseRequest();
    const after = await getDraft(request, demoSite.id);
    expect(after.draft.revision).toBe(before.draft.revision);
  });

  test("移动端工作台可在 AI 对话与网站预览之间切换且无横向溢出", async ({ page, demoSite }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const pageErrors = watchPageErrors(page);
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const chatTab = page.getByRole("tab", { name: "AI 对话" });
    const previewTab = page.getByRole("tab", { name: "网站预览" });
    await expect(chatTab).toBeVisible();
    await expect(chatTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".builder-chat")).toBeVisible();
    await expect(page.locator(".preview-shell")).toBeHidden();
    await previewTab.click();
    await expect(previewTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".preview-shell")).toBeVisible();
    await expect(page.locator(".builder-chat")).toBeHidden();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(horizontalOverflow).toBe(false);
    await snap(page, "workspace-mobile-preview", testInfo);
    expect(pageErrors).toEqual([]);
  });

  test("对话换模板必须二次确认", async ({ page, request, demoSite }) => {
    const targetTemplate = templates.find((item) => item.id !== "forge")?.id;
    expect(targetTemplate).toBeTruthy();
    await mockChat(page, demoSite.id, {
      operations: () => [{ op: "set_template", templateId: targetTemplate }],
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("换模板");
    await page.locator(".chat-input button").click();
    await expect(page.getByText("确认执行以下操作")).toBeVisible();
    expect((await getDraft(request, demoSite.id)).draft.templateId).toBe("forge");
    await page.getByRole("button", { name: "确认执行" }).click();
    await expect.poll(async () => (await getDraft(request, demoSite.id)).draft.templateId).toBe(targetTemplate);
  });

  test("确认期间 revision 冲突会采纳最新草稿并允许继续对话", async ({ page, request, demoSite }) => {
    const conflictMessage = "草稿已由另一项操作更新，已载入最新版本。";
    let retryBaseRevision: number | undefined;
    await page.route(`**/api/sites/${demoSite.id}/chat`, async (route) => {
      const body = route.request().postDataJSON() as { baseRevision: number; message: string; confirmedDestructive?: boolean };
      if (body.message === "换模板" && body.confirmedDestructive !== true) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          body: sseBody([{ type: "done", status: "need_confirmation", summary: "切换模板", destructive: ["切换网站模板"] }]),
        });
        return;
      }
      const latest = await getDraft(request, demoSite.id);
      if (body.confirmedDestructive === true) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "revision_conflict", message: conflictMessage, ...latest }),
        });
        return;
      }
      retryBaseRevision = body.baseRevision;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: sseBody([{ type: "done", status: "no_change", summary: "没有变化", ...latest }]),
      });
    });

    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    const send = page.locator(".chat-input button");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("换模板");
    await send.click();
    await expect(page.getByText("确认执行以下操作")).toBeVisible();

    const beforeConflict = await getDraft(request, demoSite.id);
    await putManualOps(request, demoSite.id, beforeConflict.draft.revision, [
      { op: "set_text", target: "companyName", locale: "zh", value: "并发更新后的企业名" },
    ]);
    const latest = await getDraft(request, demoSite.id);
    await page.getByRole("button", { name: "确认执行" }).click();

    await expect(page.getByText(conflictMessage)).toBeVisible();
    await expect(send).toBeEnabled();
    await input.fill("检查最新版本");
    await input.press("Enter");
    await expect(page.getByText("模型没有生成可应用的内容差异", { exact: false })).toBeVisible();
    expect(retryBaseRevision).toBe(latest.draft.revision);
    expect((await getDraft(request, demoSite.id)).draft.templateId).toBe("forge");
  });

  test("英文修改不污染中文内容", async ({ page, request, demoSite }) => {
    const before = await getDraft(request, demoSite.id);
    const original = (before.draft.content as { hero: { title: { zh: string } } }).hero.title.zh;
    await mockChat(page, demoSite.id, {
      operations: () => [{ op: "set_text", target: "hero.title", locale: "en", value: "Reliable sensing for global industry" }],
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("Rewrite the headline in English");
    await input.press("Enter");
    await expect(page.getByText("内容已更新", { exact: false }).last()).toBeVisible();
    const after = await getDraft(request, demoSite.id);
    const title = (after.draft.content as { hero: { title: { zh: string; en: string } } }).hero.title;
    expect(title.zh).toBe(original);
    expect(title.en).toBe("Reliable sensing for global industry");
  });

  test("对话错误保留原始指令并可一键回填", async ({ page, demoSite }) => {
    await page.route(`**/api/sites/${demoSite.id}/chat`, (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBody([{ type: "done", status: "error", error: "上游模型暂时不可用" }]),
    }));
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    const original = "把首屏改成面向德国采购商的工业风";
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill(original);
    await input.press("Enter");

    await expect(page.getByText("上游模型暂时不可用")).toBeVisible();
    await page.getByRole("button", { name: "重新填写原始指令" }).click();
    await expect(input).toHaveValue(original);
    await expect(input).toBeFocused();
  });

  test("局部重生成可取消且不改变草稿与历史", async ({ page, request, demoSite }) => {
    let releaseRequest!: () => void;
    const stalled = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route(`**/api/sites/${demoSite.id}/generate`, async (route) => {
      await stalled;
      await route.abort("aborted").catch(() => undefined);
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await expect(page.locator(".chat-input textarea")).not.toHaveAttribute("placeholder", /正在识别/);
    await page.frameLocator("iframe").locator("main h1").first().evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await page.getByRole("button", { name: "重生成此板块" }).click();
    const before = await getDraft(request, demoSite.id);

    await page.getByRole("button", { name: "重生成此板块" }).last().click();
    await page.getByRole("button", { name: "取消重生成" }).click();
    releaseRequest();

    await expect(page.getByText("已取消重生成，草稿和历史均未修改。", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "重生成此板块" }).last()).toBeEnabled();
    const after = await getDraft(request, demoSite.id);
    expect(after.draft.revision).toBe(before.draft.revision);
    expect(after.history).toEqual(before.history);
  });

  test("查看旧消息时后续错误状态不会抢回底部", async ({ page, demoSite }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    let releaseResponse!: () => void;
    const stalled = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route(`**/api/sites/${demoSite.id}/chat`, async (route) => {
      await stalled;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: sseBody([{ type: "done", status: "error", error: "稍后再试" }]),
      });
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    const messages = page.locator(".chat-messages");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("请保持模板不变，详细重写首屏、关于、优势、服务、产品和联系板块。".repeat(12));
    await input.press("Enter");
    await expect(messages.locator(".busy-message")).toBeVisible();
    await messages.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event("scroll"));
    });
    releaseResponse();
    await expect(page.getByText("稍后再试")).toBeVisible();
    await expect.poll(() => messages.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  });

  test("破坏性确认初始聚焦取消按钮并支持 Esc 关闭后归还焦点", async ({ page, demoSite }) => {
    await page.route(`**/api/sites/${demoSite.id}/chat`, (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sseBody([{ type: "done", status: "need_confirmation", summary: "切换模板", destructive: ["切换网站模板"] }]),
    }));
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("换模板");
    await input.press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "确认执行以下操作" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(input).toBeFocused();
  });

  test("改回上一条只撤销最近一次 AI 修改并显示撤销对象", async ({ page, request, demoSite }) => {
    const before = await getDraft(request, demoSite.id);
    const originalTitle = (before.draft.content as { hero: { title: { zh: string } } }).hero.title.zh;
    const ai = await commitOperations({
      siteId: demoSite.id,
      baseRevision: before.draft.revision,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "AI 临时标题" }],
      summary: "AI 重写首屏标题",
      source: "ai",
    });
    expect(ai.status).toBe("applied");
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("改回上一条");
    await input.press("Enter");

    await expect(page.getByText("已撤销 AI 修改“AI 重写首屏标题”", { exact: false })).toBeVisible();
    const after = await getDraft(request, demoSite.id);
    expect((after.draft.content as { hero: { title: { zh: string } } }).hero.title.zh).toBe(originalTitle);
    expect(after.draft.revision).toBe(before.draft.revision + 2);
    expect(after.history[0].source).toBe("manual");
  });

  test("AI 修改后存在人工提交时拒绝消息级撤销", async ({ page, request, demoSite }) => {
    const before = await getDraft(request, demoSite.id);
    const ai = await commitOperations({
      siteId: demoSite.id,
      baseRevision: before.draft.revision,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "AI 临时标题" }],
      summary: "AI 修改首屏",
      source: "ai",
    });
    expect(ai.status).toBe("applied");
    if (ai.status !== "applied") return;
    const manual = await commitOperations({
      siteId: demoSite.id,
      baseRevision: ai.record.draft.revision,
      operations: [{ op: "set_text", target: "companyName", locale: "zh", value: "人工更新后的公司名" }],
      summary: "人工更新公司名",
      source: "manual",
    });
    expect(manual.status).toBe("applied");
    if (manual.status !== "applied") return;
    const beforeUndo = await getDraft(request, demoSite.id);
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    await input.fill("撤销刚才 AI 修改");
    await input.press("Enter");

    await expect(page.getByText("AI 修改之后还有 1 项后续修改", { exact: false })).toBeVisible();
    const after = await getDraft(request, demoSite.id);
    expect(after.draft.revision).toBe(manual.record.draft.revision);
    expect(after.draft.companyName).toBe("人工更新后的公司名");
    expect(after.history).toEqual(beforeUndo.history);
  });
});
