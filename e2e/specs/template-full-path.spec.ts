/**
 * 两条完整路径：**截图 → 生成 → 保存 → 撤销** 与 **网址 → 生成 → 保存 → 撤销**。
 *
 * ## mock 在哪一层（这张表是本文件最重要的信息）
 *
 * | 层 | 真实？ | 说明 |
 * |---|---|---|
 * | 前端组件（弹窗、按钮、跳转） | **真实** | `components/create-template-dialog.tsx` |
 * | HTTP 路由（`/api/templates/from-*`） | **真实** | 含入参校验、鉴权、状态码 |
 * | 编排层（`createTemplateFromScreenshot/Url`） | **真实** | 含尺寸闸、归一、拼装、登记、建站 |
 * | 抓取（Playwright 开浏览器抓页面） | **真实** | URL 轨真抓，目标指向本地 stub 页面（零外网） |
 * | **模型调用** | **假的** | `e2e/scripts/ai-stub.mjs` 托管的本地 OpenAI 兼容服务 |
 *
 * 也就是说：**只有"模型读图"这一步被换成了确定性的本地应答**。这比在浏览器层
 * 拦 `/api/templates/from-*`（那样连路由都不会执行）真实得多——**路由与编排的真跑
 * 正是这两条 spec 的价值所在**。
 *
 * ## 怎么跑
 *
 * ```bash
 * E2E_AI_STUB=1 npx playwright test e2e/specs/template-full-path.spec.ts
 * ```
 * 没开这个开关时**整段跳过**，并说明原因——不开就跳过是**有意**的：
 * 绝不因为连不上模型而变红，也绝不静默假装跑了。
 *
 * ## 防假门禁（军规 2）
 *
 * 1. `beforeAll` 把 stub 声明的 DSL 喂给**真实的 `coerceVisionDsl`** 并断言它通过——
 *    DSL 形状一改、stub 一过期，这里**立刻红**。
 * 2. 每条路径都断言"生成**真的在盘上留下了模板目录**"——防止"界面说做好了、
 *    其实什么都没产出"这种假绿。
 */
import { test, expect } from "../helpers/fixtures";
import { getDraft, putManualOps } from "../helpers/api";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

/** stub 的地址——与 `e2e/scripts/ai-stub.mjs` 的 DEFAULT_STUB_PORT 一致。 */
const STUB_URL = process.env.E2E_AI_STUB_URL || "http://127.0.0.1:3311";
const STUB_ENABLED = process.env.E2E_AI_STUB === "1";

/** 这条链路慢：抓取 + 拼装 + 登记（内部再转一次 HTTP）+ 建站 + 质检。 */
const PATH_TIMEOUT_MS = 180_000;

/** 运行时模板的落盘目录（服务端会**扫盘装载**它，见 `lib/template-runtime-loader.ts`）。 */
const TEMPLATES_DIR = path.join(process.cwd(), ".sitecraft-data", "generated-templates");

/** 读目录名集合；目录不存在时给空集（不是错误）。 */
async function listTemplateDirs(): Promise<Set<string>> {
  try {
    return new Set(await readdir(TEMPLATES_DIR));
  } catch {
    return new Set();
  }
}

/**
 * 删掉这次测试新造出来的模板目录。
 *
 * ## 为什么不按名字前缀清（先说清这个，免得后人"优化"回去）
 *
 * 两条轨的模板 id 命名规则**不一样**：
 * - 截图轨由模型给的 `templateId` 决定（可控）；
 * - 网址轨由 `templateIdFromUrl(抓到的地址)` 决定，形如 `127-0-0-1-3311-<后缀>`——
 *   **不含任何我们能预先约定的前缀**。
 *
 * 按前缀清会漏掉网址轨（实测：连跑两次，每次都在用户的模板库里多留一个
 * `127-0-0-1-3311-xxx`）。而按"地址派生 slug"清又要复刻 `templateIdFromUrl`
 * 的替换规则——那是**手抄一份权威逻辑**，军规 1 明确禁止。
 *
 * 所以改成比对快照：跑之前拍下目录名，跑完把**多出来的**删掉。
 * 这不需要知道命名规则，也不可能误删跑之前就存在的任何东西。
 *
 * ⚠️ 前提是 `playwright.config.ts` 的 `workers: 1`（全串行）——并行时别的 spec
 * 可能在这中间落盘，"多出来的"就不一定是本测试造的了。配置改成并行时这里要跟着改。
 */
async function removeNewTemplateDirs(before: Set<string>): Promise<void> {
  const after = await listTemplateDirs();
  const created = [...after].filter((name) => !before.has(name));
  await Promise.all(
    created.map((name) => rm(path.join(TEMPLATES_DIR, name), { recursive: true, force: true }).catch(() => {})),
  );
  if (created.length) console.log(`[full-path] 清理本次生成的模板目录 ${created.length} 个：${created.join(", ")}`);
}

/** 跑之前拍下的目录快照；`afterEach` 按它清理。 */
let snapshotBeforeTest: Set<string> | null = null;

test.describe("三条入口的完整路径（截图 / 网址 → 生成 → 保存 → 撤销）", () => {
  // 不开 stub 就整段跳过，并说清原因（不静默 skip）
  test.skip(!STUB_ENABLED, "需要本地模型 stub：用 E2E_AI_STUB=1 重跑（见本文件头说明）");

  test.beforeAll(async () => {
    /**
     * 防假门禁：stub 的载荷必须能过**真实的** `coerceVisionDsl`。
     *
     * ⚠️ 刻意不在浏览器里做这件事——"这份 DSL 能不能用"必须由**服务端同一份代码**
     * 回答，而不是让测试自己再实现一遍判断（那样两边会各自漂移）。
     */
    const response = await fetch(`${STUB_URL}/__stub__/vision-dsl`);
    expect(response.ok, `stub 没起来：${STUB_URL}（E2E_AI_STUB=1 时由 serve.mjs 拉起）`).toBeTruthy();
    const { dsl } = (await response.json()) as { dsl: unknown };

    const { coerceVisionDsl } = await import("../../lib/site-vision.ts");
    const coerced = coerceVisionDsl(dsl, { locale: "zh" });
    expect(
      coerced.ok,
      `stub 的 DSL 过不了真实的 coerceVisionDsl：${coerced.ok ? "" : coerced.issues.join("；")}`,
    ).toBe(true);
  });

  // 无论测试成功还是失败都清——不留产物，也不掩盖失败
  test.afterEach(async () => {
    if (!snapshotBeforeTest) return;
    await removeNewTemplateDirs(snapshotBeforeTest);
    snapshotBeforeTest = null;
  });

  /** 断言"这次真的生成了**一个**新模板"，并把它的名字交出去供清理。 */
  async function expectOneNewTemplate(before: Set<string>): Promise<string> {
    const appeared = [...(await listTemplateDirs())].filter((name) => !before.has(name));
    expect(appeared.length, "生成必须真的在盘上留下模板目录（否则是界面说做好了、其实没产出）").toBe(1);
    return appeared[0] ?? "";
  }

  test("截图 → 生成 → 保存 → 撤销", async ({ page, request }) => {
    test.setTimeout(PATH_TIMEOUT_MS);
    snapshotBeforeTest = await listTemplateDirs();
    const before = snapshotBeforeTest;

    // ---- ① 真的传一张图上去（宽度必须过尺寸闸，所以现造 ≥800px 的图）----
    await page.goto("/templates");
    await page.getByRole("button", { name: /做新模板/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 仓库既有 fixture 只有 8×8，过不了宽度闸（`site-vision.ts` 要求 ≥800px）
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#2b6cb0" } })
      .png()
      .toBuffer();
    await dialog.locator('input[type="file"]').setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });

    // ---- ② 等真实链路跑完 ----
    await expect(dialog.getByText("做好了")).toBeVisible({ timeout: PATH_TIMEOUT_MS });
    await expectOneNewTemplate(before);

    // ---- ③ 进工作台 ----
    await dialog.getByRole("button", { name: "去编辑这个站" }).click();
    await page.waitForURL(/\/workspace\?siteId=/);
    const siteId = new URL(page.url()).searchParams.get("siteId");
    expect(siteId, "跳转 URL 里必须带 siteId").toBeTruthy();
    if (!siteId) return;

    // ---- ④ 保存一次真实修改（撤销要先有可撤销的东西）----
    const draftBefore = await getDraft(request, siteId);
    // 新站的 history 是空的——先证明这一点，免得"没得撤销"被误当成"撤销坏了"
    expect(draftBefore.canUndo, "刚生成的站不该有可撤销项").toBe(false);

    await putManualOps(request, siteId, draftBefore.draft.revision, [
      { op: "set_text", target: "hero.title", locale: "zh", value: "E2E 改过的首屏标题" },
    ]);
    const afterSave = await getDraft(request, siteId);
    expect(afterSave.canUndo, "保存之后必须可撤销").toBe(true);
    expect(JSON.stringify(afterSave.draft.content)).not.toBe(JSON.stringify(draftBefore.draft.content));

    // ---- ⑤ 点界面上的撤销 ----
    await page.reload();
    const undo = page.getByRole("button", { name: /撤销/ });
    await expect(undo).toBeEnabled();
    await undo.click();

    // ---- ⑥ 逐字段还原 ----
    await expect
      .poll(async () => JSON.stringify((await getDraft(request, siteId)).draft.content), { timeout: 30_000 })
      .toBe(JSON.stringify(draftBefore.draft.content));
    const afterUndo = await getDraft(request, siteId);
    expect(afterUndo.canUndo, "撤销到底之后就不该再能撤销").toBe(false);
    expect(afterUndo.canRedo, "撤销之后应当能重做").toBe(true);
    // ⚠️ 不断言 revision 回退——撤销是"以历史内容新建更高版本"，revision 只会涨
    expect(afterUndo.draft.revision).toBeGreaterThan(draftBefore.draft.revision);
  });

  test("网址（原样搬下来）→ 生成 → 保存 → 撤销", async ({ page, request }) => {
    test.setTimeout(PATH_TIMEOUT_MS);
    snapshotBeforeTest = await listTemplateDirs();
    const before = snapshotBeforeTest;

    await page.goto("/templates");
    await page.getByRole("button", { name: /做新模板/ }).click();
    const dialog = page.getByRole("dialog");

    // 切到"粘贴网址"这一路，并选「原样搬下来」——**这条正是刚修好的那条**
    // （修之前它必然 400：请求体形状与路由 schema 不匹配）
    await dialog.getByRole("button", { name: "粘贴网址" }).click();
    await dialog.getByRole("button", { name: /原样搬下来/ }).click();
    await dialog.locator("input.dialog-input").fill(`${STUB_URL}/sample-site`);
    await dialog.getByRole("button", { name: "开始" }).click();

    // 搬站要真开浏览器抓页面——抓的是本地 stub 页面，零外网
    await expect(dialog.getByText("做好了")).toBeVisible({ timeout: PATH_TIMEOUT_MS });
    await expectOneNewTemplate(before);
    // A 路径的如实告知必须真的出现在界面上（它就是这个路径的产品特征）
    await expect(dialog.getByText(/可以编辑的位置/)).toBeVisible();

    await dialog.getByRole("button", { name: "去编辑这个站" }).click();
    await page.waitForURL(/\/workspace\?siteId=/);
    const siteId = new URL(page.url()).searchParams.get("siteId");
    expect(siteId).toBeTruthy();
    if (!siteId) return;

    const draftBefore = await getDraft(request, siteId);
    await putManualOps(request, siteId, draftBefore.draft.revision, [
      { op: "set_text", target: "hero.title", locale: "zh", value: "E2E 搬站后改的标题" },
    ]);
    expect((await getDraft(request, siteId)).canUndo).toBe(true);

    await page.reload();
    const undo = page.getByRole("button", { name: /撤销/ });
    await expect(undo).toBeEnabled();
    await undo.click();

    await expect
      .poll(async () => JSON.stringify((await getDraft(request, siteId)).draft.content), { timeout: 30_000 })
      .toBe(JSON.stringify(draftBefore.draft.content));
    expect((await getDraft(request, siteId)).canUndo).toBe(false);
  });
});
