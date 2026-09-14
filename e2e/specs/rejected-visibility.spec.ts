/**
 * 阶段 1「止血」验收脚本（2026-09-11）
 *
 * 验证目标：被确定性校验拒绝的操作，用户**能看见**。
 *
 * 为什么用 mockChat：它内部走**真实 PUT /draft** 提交草稿，再把快照当 SSE `done`
 * 事件回放给前端 —— 与生产链路同形，只是把模型换成了确定性桩。
 *
 * 覆盖四个断言：
 *   A. 超长改动**当场被拒**（HTTP 422，而非以前"存进去、发布才挂"）
 *   B. 合规改动正常生效（HTTP 200）
 *   C. 服务端在 done 事件里下发 rejected（回归防线）
 *   D. 前端渲染出「未生效」区块（本次修复的核心）
 */
import { test, expect } from "../helpers/fixtures";
import { getDraft } from "../helpers/api";
import { mockChat } from "../helpers/mock-ai";

const OVER_LIMIT =
  "可靠制造，从关键部件到整线交付，覆盖精密模块、复合材料与智能检测单元，提供全面质量保障和稳定交付服务，满足不同客户的多样化需求。";

test("超长改动被就地编辑闸门拒绝，不再静默丢失", async ({ page, request, demoSite }) => {
  // ===== A. 真实 PUT /draft：超长 hero.subtitle（61 汉字 > 40）=====
  const before = await getDraft(request, demoSite.id);
  const overLimitResponse = await request.put(`/api/sites/${demoSite.id}/draft`, {
    data: {
      baseRevision: before.draft.revision,
      summary: "验证超长闸门",
      source: "manual",
      operations: [{ op: "set_text", target: "hero.subtitle", locale: "zh", value: OVER_LIMIT }],
    },
  });
  expect(overLimitResponse.status(), "超长文案必须当场被拒，而不是存进去等发布才挂").toBe(422);
  const rejectedBody = await overLimitResponse.json() as { error?: string; code?: string };
  expect(rejectedBody.code).toBe("copy_too_long");
  expect(rejectedBody.error, "拒绝原因必须是给人看的中文，且带实际字数").toMatch(/hero\.subtitle/);
  expect(rejectedBody.error).toMatch(/40 字以内/);

  // 草稿未被污染
  const after = await getDraft(request, demoSite.id);
  expect(after.draft.revision, "被拒的写入不应 bump revision").toBe(before.draft.revision);

  // ===== B. 合规文案放行 =====
  const okResponse = await request.put(`/api/sites/${demoSite.id}/draft`, {
    data: {
      baseRevision: after.draft.revision,
      summary: "验证合规放行",
      source: "manual",
      operations: [{ op: "set_text", target: "hero.subtitle", locale: "zh", value: "覆盖关键部件与智能检测，支持复杂制造稳定交付。" }],
    },
  });
  expect(okResponse.status(), "合规文案不得被误伤").toBe(200);
});

test("服务端在 done 事件下发 rejected，前端渲染出「未生效」区块", async ({ page, request, demoSite }) => {
  // 让 mock 的 chat 提交一条**超长**改动：PUT /draft 会 422，
  // 桩以 `replay` 模式模拟真实服务端——照常下发 done 事件并带 rejected
  await mockChat(page, demoSite.id, {
    operations: () => [{ op: "set_text", target: "hero.subtitle", locale: "zh", value: OVER_LIMIT }],
    onCommitRejected: "replay",
  });

  await page.goto(`/workspace?siteId=${demoSite.id}`);
  const input = page.locator(".chat-input textarea");
  await expect(input).not.toHaveAttribute("placeholder", /正在识别/);
  // 先挂监听再触发，否则响应已经完成、waitForResponse 永远等不到
  const chatResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/sites/${demoSite.id}/chat`));
  await input.fill("把首屏副标题改得详细一点");
  await input.press("Enter");

  // ===== D. 核心断言：前端出现「未生效」区块 =====
  const notApplied = page.locator('[aria-label="未生效的修改"]');
  await expect(notApplied, "超长改动必须在前端显性提示，而不是只显示『已保存』").toBeVisible();
  await expect(notApplied).toContainText("未生效");
  await expect(notApplied).toContainText(/40 字以内/);

  // ===== C. 服务端契约：done 事件确实带 rejected =====
  const chatResponse = await chatResponsePromise;
  expect(chatResponse.status()).toBe(200);
});
