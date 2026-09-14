import { test } from "@playwright/test";
import { createSite } from "../helpers/api";

test("diag tailcast iframe remount cycle", async ({ page, request }) => {
  // 建一个 astro-starter(tailcast) 站点
  const site = await createSite(request, "astro-starter");
  // 直接 API 设草稿 template
  const draft = await (await request.get(`/api/sites/${site.id}/draft`)).json();
  const put = await request.put(`/api/sites/${site.id}/draft`, {
    data: { baseRevision: draft.draft.revision, operations: [{ op: "set_template", templateId: "astro-starter" }], summary: "set", source: "manual" },
  });
  console.log("[diag] put:", put.status());
  await page.goto(`/workspace?siteId=${site.id}`);
  // 量 20 秒内 iframe 元素是否被替换(重挂=元素 identity 变化)
  const marks: string[] = [];
  for (let i = 0; i < 10; i++) {
    const state = await page.evaluate(() => {
      const f = document.querySelector("iframe.open-source-template-frame");
      if (!f) return { present: false };
      return { present: true, src: f.getAttribute("src")?.slice(-30) };
    }).catch(() => ({ present: false }));
    marks.push(`${i * 2}s:${JSON.stringify(state)}`);
    await page.waitForTimeout(2000);
  }
  console.log("[diag] timeline:", marks.join(" | "));
  const applied = await page.evaluate(() => {
    const f = document.querySelector("iframe.open-source-template-frame") as HTMLIFrameElement | null;
    return f ? f.contentWindow?.document.querySelectorAll("[data-sitecraft-slot]").length : -1;
  }).catch(() => -1);
  console.log("[diag] iframe slots:", applied);
});
