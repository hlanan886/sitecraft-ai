import { test, expect } from "../helpers/fixtures";
import { snap } from "../helpers/ui";
import { checkDraftContract, formatViolations, hardViolations } from "../helpers/draft-contract";

test("@real 真实 DeepSeek 从一句话生成到工作台", async ({ page, request }, testInfo) => {
  test.skip(process.env.E2E_REAL_AI !== "1", "仅由 npm run test:e2e:real 显式启用");
  test.setTimeout(180_000);
  await page.goto("/generate");
  await page.locator(".generate-textarea").first().fill("为一家出口欧洲的工业传感器企业做官网，专业可靠，突出质量和交付");
  await page.locator(".generate-input .primary-button").click();
  await expect(page.locator(".generate-confirm")).toBeVisible({ timeout: 60_000 });
  await snap(page, "real-confirm", testInfo);
  await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();

  // ── 等生成真正结束（2026-09-10 修正）───────────────────────────────
  // 踩过的坑：此前用 `.generate-progress-view` 可见当作"生成完成"，但该类名
  // **同时用于生成中态与完成态**（app/generate/page.tsx:1206 与 :1293），
  // 于是生成才 36% 时测试就以为完事了，去找一个还不存在的按钮 → 静默跳过点击
  // → 空等 URL 超时。DOM 快照证据见 git 历史里的 error-context。
  //
  // 生成结束有两种落点，必须都等：
  //  (a) 全部成功 → `step="done"`，1.2s 后自动 router.push 到工作台（按钮不会出现）
  //  (b) 部分失败 → 停在确认页，显示「进入工作台继续补全」按钮，等用户点
  //
  // 用一次 waitForFunction 同时等两者，而不是 Promise.race——后者在超时分支会
  // 产生未捕获的 rejection，直接把测试判失败（也踩过）。
  await page.waitForFunction(
    () => {
      const onWorkspace = location.pathname.startsWith("/workspace");
      const hasEnter = [...document.querySelectorAll("button")]
        .some((b) => /进入工作台/.test(b.textContent ?? ""));
      return onWorkspace || hasEnter;
    },
    undefined,
    { timeout: 150_000 },
  );

  // 未自动跳转 = 走了 partial 降级路径。这是产品现状，在 CI 输出里留痕
  // （跨次比较趋势比单次值有意义）。
  const enterWorkspace = page.getByRole("button", { name: /进入工作台/ });
  if (await enterWorkspace.count() > 0) {
    const label = (await enterWorkspace.textContent())?.trim() ?? "";
    console.log(`⚠️ 本次生成走 partial 降级路径（按钮="${label}"）`);
    await enterWorkspace.click();
  }
  // 导航失败时 dump 证据，避免只看到"URL 没变"而不知为何
  try {
    await expect(page).toHaveURL(/\/workspace\?siteId=/, { timeout: 60_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.href,
      stepDone: !!document.querySelector(".generate-progress-view"),
      hasCompletion: !!document.querySelector(".generate-completion-progress-meta"),
      buttons: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 12),
      bodyHead: document.body.innerText.slice(0, 300),
    })).catch(() => null);
    console.log("❌ 导航失败，页面状态：", JSON.stringify(state, null, 2));
    throw error;
  }

  // ── 产物契约（2026-09-10）─────────────────────────────────────────
  // 此前这条测试只验证「流程能走通」，不验证「产物对不对」——
  // 于是首屏出现「待补充」、about 正文等于 defaultDraft 这类问题
  // 在 489 个单元测试下全绿地漏到了真机上。见
  // docs/audits/2026-09-10-nl-site-architecture-gap-analysis.md
  const siteId = new URL(page.url()).searchParams.get("siteId");
  expect(siteId, "生成后 URL 应带 siteId").toBeTruthy();
  const draftResponse = await request.get(`/api/sites/${siteId}/draft`);
  expect(draftResponse.ok(), "应能读到草稿").toBeTruthy();
  const { draft } = await draftResponse.json() as { draft: Parameters<typeof checkDraftContract>[0] };
  const violations = checkDraftContract(draft, "zh");
  // 打印全部（含软警告）——诊断时逐项可比对，呼应「真回归是同一项反复失败」
  console.log(formatViolations(violations));
  expect(
    hardViolations(violations),
    `生成产物违反契约：\n${formatViolations(hardViolations(violations))}`,
  ).toEqual([]);

  const input = page.locator(".chat-input textarea");
  await expect(input).not.toHaveAttribute("placeholder", /正在识别/, { timeout: 30_000 });
  await input.fill("把主标题改得更聚焦工业传感器，不要虚构数据");
  await page.locator(".chat-input button").click();
  await expect(page.getByText(/草稿 v\d+ 已保存|修改已应用/).last()).toBeVisible({ timeout: 90_000 });
  await snap(page, "real-workspace", testInfo);
});
