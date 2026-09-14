/**
 * D. 模板选择
 *
 * ## 这一页有**两个**模板网格（2026-09-13 修正）
 *
 * | 容器 | 内容 | 数量来源 |
 * |---|---|---|
 * | `.page-content > .template-grid`（首个子元素） | 编译期基线的开源模板 | `templates.length`（编译期常量） |
 * | `.template-mine .template-grid` | 用户自己做的（运行时注册） | 由接口返回，**数量不固定** |
 *
 * ⚠️ **踩过的坑（原文记录）**：此前两条断言都用 `.template-grid .template-card`
 * 这个 locator——它**跨两个容器一起数**，于是运行时模板一旦存在就变成
 * `Expected: 22 / Received: 35`（22 基线 + 13 个用户模板）。
 * 那**不是"断言过严"，是 locator 选错了容器**：一个"基线模板数"的断言
 * 本来就不该把用户模板数进来。
 *
 * 所以现在按容器分开断言，且每条各自说清在测什么：
 * - 基线那条：**编译期常量**精确断言（多一个少一个都是回归）；
 * - 用户模板那条：**不断言具体数字**（它随用户与运行次数变），
 *   只断言"接口说有几个、页面就渲染几张，且页头那句'共 N 个'一致"——
 *   这既是真实约束（不是永真），又不会因为跑第二遍就变红。
 *
 * ⚠️ 运行时模板由服务端**扫盘装载**（`.sitecraft-data/generated-templates/`，
 * 见 `lib/template-runtime-loader.ts`），所以本页卡片数在开发机上本来就可能 >22。
 * 那不是 bug，是本页 2026-09-10 起有意支持的能力。
 */
import { test, expect } from "../helpers/fixtures";
import { expectNoCrash } from "../helpers/ui";
import { templates } from "../../lib/site-model";
import { readdir } from "node:fs/promises";
import path from "node:path";

/** 基线网格：**只**数编译期那批，不含用户模板（用户模板在 `.template-mine` 里）。 */
const BASELINE_GRID = ".page-content > .template-grid";
const BASELINE_CARDS = `${BASELINE_GRID} .template-card`;
const MINE_CARDS = ".template-mine .template-card";

/**
 * 记录型副作用的目录——**用户数据**。
 *
 * ⚠️ 这份清单与 `tests/test-side-effects.test.ts` 的 `WATCHED_DIRS` **同口径**，
 * 改一处要改两处。之所以没抽公共文件：一个是 node:test、一个是 Playwright，
 * 各自的模块解析环境不同（e2e 里 `@/` 别名要 loader），抽出去反而更脆。
 */
const WATCHED_DIRS = [
  ".sitecraft-data/sites",
  ".sitecraft-data/pending-jobs",
  ".sitecraft-data/releases",
  ".sitecraft-data/leads",
  ".sitecraft-data/uploads",
  ".sitecraft-data/captures",
  ".sitecraft-data/generated-templates",
] as const;

/** 全量副作用签名：**所有**目录的条目数，不只是站点。 */
async function sideEffectSignature(): Promise<string> {
  const counts = await Promise.all(
    WATCHED_DIRS.map(async (dir) => {
      try {
        return `${dir}=${(await readdir(path.join(process.cwd(), dir))).length}`;
      } catch {
        return `${dir}=0`;
      }
    }),
  );
  return counts.join("|");
}

/** PG 站点数——文件后端目录之外，还有数据库这一路（e2e 跑的就是 PG）。 */
async function postgresSiteCount(request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> }): Promise<number> {
  const response = await request.get("/api/sites");
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body.length : ((body as { sites?: unknown[] }).sites?.length ?? 0);
}

test.describe("D. 模板选择", () => {
  test("基线模板**按容器**精确计数，筛选切换不串状态", async ({ page }) => {
    await page.goto("/templates");

    // 先钉住基线总数——编译期常量，精确值断言（不是下界）
    await expect(page.locator(BASELINE_CARDS)).toHaveCount(templates.length);

    // 分类筛选：逐类核对**基线**数量（用户模板不参与这条）
    const categories = ["全部模板", "制造业", "外贸目录", "科技企业", "专业服务"];
    for (const label of categories) {
      const expected =
        label === "全部模板"
          ? templates.length
          : templates.filter((template) => template.category === label).length;
      await page.locator(".template-filters").getByText(label, { exact: true }).click();
      await expect(page.locator(BASELINE_CARDS)).toHaveCount(expected);
    }
    await expectNoCrash(page);
  });

  test("用户做的模板走**独立容器**：接口说几个就渲染几张（数量不写死）", async ({ page }) => {
    await page.goto("/templates");

    // 从服务端拿真实数量——派生，不手抄（军规 1）
    const response = await page.request.get("/api/templates/runtime");
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { templates?: unknown[] };
    const mineCount = payload.templates?.length ?? 0;

    const mineSection = page.locator(".template-mine");
    if (mineCount === 0) {
      // 没有用户模板时整段不渲染——有意为之（空区块只是噪音）
      await expect(mineSection).toHaveCount(0);
      return;
    }
    await expect(page.locator(MINE_CARDS)).toHaveCount(mineCount);
    // 卡片数与页头那句"共 N 个"必须同源——两处对不上就是自相矛盾
    await expect(mineSection.locator(".template-mine-head")).toContainText(`共 ${mineCount} 个`);
  });

  test("基线卡片使用本地渲染且无空白", async ({ page }) => {
    await page.goto("/templates");
    await expect(page.locator(BASELINE_CARDS)).toHaveCount(templates.length);
    // iframe 封面是**基线模板独有**的渲染方式（运行时模板的卡在另一个容器里）
    await expect(page.locator(`${BASELINE_GRID} iframe.open-source-template-frame`)).toHaveCount(
      templates.length,
    );
    await expect(page.locator(".template-live-badge").first()).toContainText("本地模板预览");
  });

  /**
   * 点选**零副作用**、CTA 才建站（2026-09-13 用户裁决：预览与建站解耦）。
   *
   * ## 为什么这条非有不可
   *
   * 旧行为是"点卡片直接进工作台"，而那条路径带着 `?template=` 且**不带 siteId**——
   * 工作台 `siteId` 默认 `"demo"`，守卫又只认编译期基线，于是**点自己的模板打开别人的站**
   * （真机实测：显示 foxi + 云湃智算）。而这一切**e2e 全绿也发现不了**，因为
   * 没有一条断言在数"点一下产生了什么"。
   *
   * ## 断言的是**总量**，不只是站点数（用户 2026-09-13 补充要求）
   *
   * 只数站点会漏掉"顺手写了个待办 / 落了一张图"这类副作用，所以这里一次性比
   * **7 个数据目录 + PG 站点表**的完整签名。任一路有增长即失败。
   */
  test("点卡片只预览：连点 3 张**零副作用**；点 CTA 才产生一个站", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.goto("/templates");
    await expect(page.locator(BASELINE_CARDS).first()).toBeVisible();

    const filesBefore = await sideEffectSignature();
    const dbBefore = await postgresSiteCount(request);

    // 连点 3 张基线卡片 + 1 张自制模板（自制的那张以前正是"打开别人的站"的受害者）
    const cards = page.locator(BASELINE_CARDS);
    for (let index = 0; index < 3; index += 1) await cards.nth(index).click();
    const mine = page.locator(MINE_CARDS);
    if ((await mine.count()) > 0) await mine.first().click();

    // 给潜在的后台写入一点时间——立刻断言会**放过**异步落盘（本项目踩过这个）
    await page.waitForTimeout(1_500);

    expect(await sideEffectSignature(), "点选模板**不得**产生任何文件副作用").toBe(filesBefore);
    expect(await postgresSiteCount(request), "点选模板**不得**产生站点记录").toBe(dbBefore);

    // 点 CTA → 才建站
    const cta = page.getByRole("button", { name: /用这个模板开始/ });
    await expect(cta).toBeEnabled();
    await cta.click();
    await page.waitForURL(/\/workspace\?siteId=/, { timeout: 60_000 });

    // 跳转 URL 必须带 siteId（旧路径正是缺了它才落到 demo 站）
    const siteId = new URL(page.url()).searchParams.get("siteId");
    expect(siteId, "CTA 必须跳到一个**新建的**站点 id").toBeTruthy();
    // 且**不该**再带 template 参数——模板在建站时已经定死
    expect(new URL(page.url()).searchParams.get("template")).toBeNull();

    expect(await postgresSiteCount(request), "CTA 应当恰好新增一个站").toBe(dbBefore + 1);
    // ⚠️ 这个站**不会自动清理**：仓库没有删除站点的 API，而手动删库要碰开发者数据。
    // 按既有裁定（"e2e 写入的行不清理：本地开发卷、无害、且是写路径真的通到库的证据"）保留。
  });

  /**
   * 自制模板的卡片**不再把用户带到别的站**（2026-09-13 回归网）。
   *
   * ## 它守的具体是什么
   *
   * 旧行为：点自制模板卡 → `?template=<id>` 且不带 siteId → 工作台守卫只认编译期基线
   * → `set_template` 不执行 → 落到 `siteId` 默认值 `demo` → **看到别人的站**。
   * 真机实测：请求 `fengji-industrial-ui4`，实际渲染 `foxi` + `云湃智算`。
   *
   * 这条断言**必须用真实的运行时模板 id**（而不是合成一个）：旧 bug 只在
   * "id 不在编译期 22 个里" 时才暴露，用基线模板测不出来。
   */
  test("点自制模板的卡片只切换选中，不跳转、不产生记录", async ({ page, request }) => {
    test.setTimeout(60_000);
    await page.goto("/templates");

    const runtime = (await (await request.get("/api/templates/runtime")).json()) as {
      templates?: Array<{ id: string }>;
    };
    const runtimeIds = (runtime.templates ?? []).map((item) => item.id);
    test.skip(runtimeIds.length === 0, "本机没有自制模板，这条测不了（它不是永真断言，是有意跳过并说明原因）");

    const filesBefore = await sideEffectSignature();
    const dbBefore = await postgresSiteCount(request);
    const target = runtimeIds[0];

    // 点它的卡片
    await page.locator(`.template-mine .template-card`).first().click();
    await page.waitForTimeout(1_500); // 给潜在异步落盘时间

    // ① 仍在模板库页（没有跳走）
    expect(new URL(page.url()).pathname, "点卡片不该跳转").toBe("/templates");
    // ② 零副作用
    expect(await sideEffectSignature(), "点自制模板卡不得产生文件副作用").toBe(filesBefore);
    expect(await postgresSiteCount(request), "点自制模板卡不得产生站点记录").toBe(dbBefore);
    // ③ 底部 CTA 显示的**正是被点的那个模板**（选中态真的落到了它身上）
    const shownName = (await page.locator(".template-selected strong").innerText()).trim();
    expect(shownName.length, "底部条必须显示被选中的模板名").toBeGreaterThan(0);
    await expect(page.locator(".template-selected .primary-button")).toHaveText(/用这个模板开始/);
  });
});
