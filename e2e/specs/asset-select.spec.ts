/**
 * 资产点选：点真实模板的**首屏主视觉** → 打开资产替换弹窗。
 *
 * ## 名字里的历史（原名 `tmp-asset.spec.ts`）
 *
 * 原文件叫 `tmp-asset`——"tmp" 是考古层命名，与它测的内容（资产点选）无关，
 * 已更名。**改名不改意图**：它一直测的就是"点图 → 能换图"。
 *
 * ## 为什么换模板重写（2026-09-13，0.6-3）
 *
 * 原断言挑的是 `forge` 的 `heroimg`，但**在 forge 上结构不可达**：
 * 它是**全幅背景图**，文字层整片压在上面，`elementFromPoint` 拿不到 img 本身。
 * 工作台里的实测（见 `e2e/specs/clickable-asset-probe.spec.ts`）：
 *
 * | 模板 | 图上"点到 img 本身"的比例 |
 * |---|---|
 * | moon / kindred / tailwind-landing / atlas / astro-starter | 100% |
 * | lonestone | 75% |
 * | **forge** | **0%**（遮挡 `DIV,H1`） |
 * | landwind / foxi / yukina / fresh / screwfast | 选择器在工作台里无命中 |
 *
 * ⚠️ **必须用「工作台里」的数字**：`landwind` 在**裸预览**页是 100%，
 * 进了工作台却命中 0×0。原 spec 正是只看了裸预览才挑错模板。
 * 所以本 spec 用 `moon`，并在**工作台里**再自证一次可点。
 *
 * ## 另一处修正：弹窗不是 `.import-modal`
 *
 * 原 spec 断言 `.import-modal`——那是**导入商品表格**的弹窗。
 * 资产点选打开的其实是 `assetDialog`（`app/workspace/page.tsx:1403` 的
 * `onAssetSelect={(payload) => setAssetDialog(payload)}`，`:1406` 起渲染），
 * 标题「替换首屏主视觉」。原断言**连对象都找错了**。
 *
 * > ⚠️ **本 spec 不覆盖的东西**：`forge` 那类"全幅背景式 hero"的用户
 * > **点不到主视觉**（本 spec 因此换模板才能成立）。那是**真实产品缺口**，
 * > 登记为 **T-15**，不在本 spec 里掩盖。
 */
import { test, expect } from "../helpers/fixtures";
import { createSite } from "../helpers/api";

/**
 * 目标模板与选择器**派生自权威源** `lib/template-asset-registry.ts`
 * （禁手抄，军规 1），并在工作台里实测为 100% 可点。
 */
const TEMPLATE_ID = "moon";
const HERO_SELECTOR = 'img[src*="astronaut"]';

test("点首屏主视觉 → 打开资产替换弹窗（moon，工作台实测处处可点）", async ({ page, request }) => {
  // 站点必须用**被测量的那个模板**建（`demoSite` 夹具默认是 forge，会测错模板）
  const site = await createSite(request, TEMPLATE_ID);
  await page.goto(`/workspace?siteId=${site.id}`);
  await page.getByRole("button", { name: "直接编辑" }).click();
  await page.waitForTimeout(800);

  const frame = page.frameLocator("iframe");
  const img = frame.locator(HERO_SELECTOR).first();
  await img.waitFor({ timeout: 20_000 });

  /**
   * 先自证"这张图真的可点"——这是本 spec 换模板的**理由**，
   * 也防止将来模板改版后这里悄悄退化成 forge 那种不可点形态
   * （那时应当红，而不是"点不中所以断言不到弹窗"这种难查的失败）。
   *
   * ⚠️ `locator.evaluate` 的第一个参数是**元素句柄**（这里是 body），
   * 不是我们想传的 selector——所以 selector 走第二个参数。
   */
  const clickable = await frame.locator("body").evaluate((_body, selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { ok: false, why: "图上找不到选择器命中的元素" };
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return { ok: false, why: `命中元素太小 ${Math.round(r.width)}x${Math.round(r.height)}` };
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: hit === el, why: hit === el ? "" : `中心点被 ${hit?.tagName ?? "null"} 覆盖` };
  }, HERO_SELECTOR);
  expect(clickable.ok, `前置条件：该模板的主视觉必须可点（${clickable.why}）`).toBe(true);

  // 用鼠标真实点击（不调 JS click——要测的正是"用户的点击会不会落到图上"）
  const box = await img.boundingBox();
  expect(box, "主视觉必须有可见的包围盒").toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // 资产替换弹窗（标题是给用户看的文案，断言它而不是 class）
  const dialog = page.getByRole("heading", { name: "替换首屏主视觉" });
  await expect(dialog, "点主视觉应当打开资产替换弹窗").toBeVisible({ timeout: 10_000 });
  // 弹窗里要能看到"当前图片"——用户得知道自己在换哪张
  await expect(page.locator(".asset-preview")).toBeVisible();
});
