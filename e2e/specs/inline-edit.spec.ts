import { test, expect } from "../helpers/fixtures";
import { getDraft } from "../helpers/api";
import { watchPageErrors } from "../helpers/ui";

/**
 * P3.1 就地编辑端到端（2026-09-09）。
 *
 * 覆盖红队二次取证发现的 4 个阻断点：
 *  1. 光标/编辑态被全量重注入打断（M1 挂起）
 *  2. 点选抢焦点（父窗口 focus()）
 *  3. 提交后草稿写入 + 预览刷新
 *  4. 不可编辑节点回落提示
 */

async function enterDirectMode(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "直接编辑" }).click();
  // 切换后父组件会重发一次 content（带 editMode: direct），bridge 收到后才生效。
  // 不等这一个来回就点击，会命中旧的 ai 模式（2026-09-09 实测的测试竞态）。
  await page.waitForTimeout(400);
}

test.describe("P3.1 就地编辑", () => {
  test("direct 模式点选首屏标题可就地编辑并写回草稿", async ({ page, demoSite }) => {
    const pageErrors = watchPageErrors(page);
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const heroTitle = frame.locator('[data-sitecraft-slot^="hero.title."]').first();
    await expect(heroTitle).toBeVisible({ timeout: 20_000 });
    const before = (await heroTitle.textContent())?.trim() ?? "";

    await heroTitle.click({ force: true });
    // 进入编辑态：contenteditable + 独立标记
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(1);
    await expect(heroTitle).toHaveAttribute("contenteditable", "plaintext-only");

    const next = `${before}（就地编辑）`;
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(next);
    await page.keyboard.press("Enter");

    // 草稿写回（轮询等待服务端 revision 变化）
    await expect
      .poll(async () => {
        const snapshot = await getDraft(page.request, demoSite.id);
        return snapshot.draft.content.hero.title.zh;
      }, { timeout: 15_000 })
      .toBe(next);

    // 编辑态退出 + 预览刷新
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(0);
    await expect
      .poll(async () => (await frame.locator('[data-sitecraft-slot^="hero.title."]').first().textContent())?.trim(), { timeout: 15_000 })
      .toBe(next);
    expect(pageErrors).toEqual([]);
  });

  test("编辑过程中不会被重注入覆盖（M1 挂起）", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const heroTitle = frame.locator('[data-sitecraft-slot^="hero.title."]').first();
    await expect(heroTitle).toBeVisible({ timeout: 20_000 });
    await heroTitle.click({ force: true });
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(1);

    // 输入后保持 2 秒不提交——期间父窗口的 500/1500ms 重试会发出 content 消息。
    // 若 M1 未生效，节点会被重建、编辑态丢失。
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("编辑中不应被覆盖");
    await page.waitForTimeout(2200);
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(1);
    expect((await heroTitle.textContent())?.trim()).toBe("编辑中不应被覆盖");

    // Esc 取消后回到原值
    await page.keyboard.press("Escape");
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(0);
  });

  test("点选模板固定文案（footer）不进入编辑态并给出提示", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const footerSlot = frame.locator('[data-sitecraft-slot^="footer."]').first();
    if ((await footerSlot.count()) === 0) test.skip(true, "该模板没有 footer slot");
    await footerSlot.click({ force: true });
    await expect(page.locator(".edit-hint")).toBeVisible({ timeout: 10_000 });
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(0);
  });

  test("AI 模式（默认）下点选仍走对话框，不进入编辑态", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    const frame = page.frameLocator("iframe");
    const heroTitle = frame.locator('[data-sitecraft-slot^="hero.title."]').first();
    await expect(heroTitle).toBeVisible({ timeout: 20_000 });
    await heroTitle.click({ force: true });
    await expect(frame.locator('[data-sitecraft-editing="true"]')).toHaveCount(0);
    await expect(page.locator(".chat-input textarea")).not.toHaveValue("");
  });
});
