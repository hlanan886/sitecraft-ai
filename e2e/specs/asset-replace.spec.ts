import { test, expect } from "../helpers/fixtures";
import { getDraft } from "../helpers/api";
import { watchPageErrors } from "../helpers/ui";

/**
 * P3.2 图片替换端到端（2026-09-09）。
 *
 * 覆盖红队修正后的设计：
 *  - 逐模板显式 selector（fail-closed），不用「hero 区最大 img」启发式
 *  - 替换后清 srcset（否则浏览器仍用旧图）
 *  - asset: null 恢复模板原图
 *  - 不支持的模板明确提示，不静默
 */

const FIXTURE_IMAGE = "e2e/fixtures/asset-sample.png";

async function enterDirectMode(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "直接编辑" }).click();
  await page.waitForTimeout(400);
}

/**
 * 点击图片上「空白处」——模板的 hero 图常被文字容器（relative z-10）完全覆盖，
 * 命中 img 本身的位置可能根本不存在（forge 实测）。用户实际点的是图上没文字的地方，
 * 所以这里找「落在图片矩形内、且没有命中文字槽」的点。
 */
async function clickImageBlankArea(page: import("@playwright/test").Page, frame: ReturnType<typeof page.frameLocator>, selector: string) {
  const image = frame.locator(selector).first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  const point = await frame.locator("body").evaluate((_body, sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const ratio of [0.85, 0.75, 0.15, 0.25, 0.5]) {
      const x = r.left + r.width / 2;
      const y = r.top + r.height * ratio;
      if (y < 0 || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      // 命中文字槽（标题/副文/按钮）说明这里点的是文字，不是图
      if (hit.closest("[data-sitecraft-slot]") && !hit.closest("img")) continue;
      return { x, y };
    }
    return null;
  }, selector);
  expect(point, `未找到可点击的图片区域：${selector}`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

test.describe("P3.2 图片替换", () => {
  test("点选首屏主视觉可上传替换并写回草稿", async ({ page, demoSite }) => {
    const pageErrors = watchPageErrors(page);
    // demoSite 默认 forge；它的 hero 图在注册表里（img[src*="heroimg"]）
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const heroImage = frame.locator('img[src*="heroimg"]').first();
    await clickImageBlankArea(page, frame, 'img[src*="heroimg"]');

    // 弹窗出现
    const dialog = page.locator(".import-modal").filter({ hasText: "替换首屏主视觉" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.setInputFiles('input[type="file"]', FIXTURE_IMAGE);

    // 草稿写入
    await expect
      .poll(async () => {
        const snapshot = await getDraft(page.request, demoSite.id);
        return snapshot.draft.assets?.["hero.image"]?.url ?? "";
      }, { timeout: 20_000 })
      .toContain("/api/product-images/");

    // 预览里主图 src 已换、srcset 已清。
    // 注意：替换后 src 不再包含 heroimg，必须改用 bridge 打的 data-sitecraft-asset 标记定位。
    const replacedImage = frame.locator('[data-sitecraft-asset="hero.image"]').first();
    await expect(replacedImage).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(async () => await replacedImage.getAttribute("src"), { timeout: 15_000 }).toContain("/api/product-images/");
    expect(await replacedImage.getAttribute("srcset")).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("恢复模板原图把资产清空并还原 src", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const heroImage = frame.locator('img[src*="heroimg"]').first();
    await expect(heroImage).toBeVisible({ timeout: 20_000 });
    const originalSrc = await heroImage.getAttribute("src");

    await clickImageBlankArea(page, frame, 'img[src*="heroimg"]');
    await page.setInputFiles('input[type="file"]', FIXTURE_IMAGE);
    await expect
      .poll(async () => (await getDraft(page.request, demoSite.id)).draft.assets?.["hero.image"]?.url ?? "", { timeout: 20_000 })
      .toContain("/api/product-images/");

    // 重新打开弹窗（点已被替换的图），点「恢复模板原图」
    await clickImageBlankArea(page, frame, '[data-sitecraft-asset="hero.image"]');
    const dialog = page.locator(".import-modal").filter({ hasText: "替换首屏主视觉" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "恢复模板原图" }).click();

    await expect
      .poll(async () => (await getDraft(page.request, demoSite.id)).draft.assets?.["hero.image"], { timeout: 20_000 })
      .toBeUndefined();
    // 还原后 data-sitecraft-asset 被移除，src 回到模板原图
    await expect(frame.locator('[data-sitecraft-asset="hero.image"]')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => await heroImage.getAttribute("src"), { timeout: 15_000 }).toBe(originalSrc);
  });

  test("不可替换的模板点图片不弹窗", async ({ page, demoSite, request }) => {
    // powerai 在注册表里是 no_img_element（首屏无图），点导航 logo 不应打开替换弹窗
    const created = await request.post("/api/sites", { data: { templateId: "powerai" } });
    const site = (await created.json()) as { id: string };
    await page.goto(`/workspace?siteId=${site.id}`);
    await enterDirectMode(page);

    const frame = page.frameLocator("iframe");
    const anyImage = frame.locator("img").first();
    if ((await anyImage.count()) === 0) test.skip(true, "该模板页面无 img");
    await anyImage.click({ force: true });
    await page.waitForTimeout(800);
    await expect(page.locator(".import-modal").filter({ hasText: "替换" })).toHaveCount(0);
  });
});
