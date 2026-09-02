import { test, expect } from "../helpers/fixtures";
import { getDraft, putManualOps } from "../helpers/api";
import { mockChat } from "../helpers/mock-ai";
import { expectNoCrash, watchPageErrors } from "../helpers/ui";
import { templates } from "../../lib/site-model";

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

  test("iframe 预览失败时降级为本地预览而不白屏", async ({ page, demoSite }) => {
    const pageErrors = watchPageErrors(page);
    await page.route("**/api/templates/*/preview**", (route) => route.abort("failed"));
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await expect(page.getByText("当前为本地近似预览", { exact: false })).toBeVisible();
    await expect(page.locator(".rendered-site")).toBeVisible();
    await expectNoCrash(page);
    expect(pageErrors).toEqual([]);
  });

  test("同一槽位连续修改 5 次保持草稿与预览状态一致", async ({ page, request, demoSite }) => {
    let version = 0;
    await mockChat(page, demoSite.id, {
      operations: () => [{ op: "set_text", target: "hero.title", locale: "zh", value: `第 ${++version} 版工业标题` }],
    });
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const input = page.locator(".chat-input textarea");
    await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
    for (let i = 1; i <= 5; i += 1) {
      await input.fill(`第 ${i} 次修改主标题`);
      await input.press("Enter");
      await expect(page.getByText("内容已更新", { exact: false }).last()).toBeVisible();
    }
    const snapshot = await getDraft(request, demoSite.id);
    const content = snapshot.draft.content as { hero: { title: { zh: string } } };
    expect(content.hero.title.zh).toBe("第 5 版工业标题");
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
});
