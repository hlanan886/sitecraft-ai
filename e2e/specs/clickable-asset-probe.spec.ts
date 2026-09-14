/**
 * 诊断探针（**不参与默认回归**，见 `playwright.config.ts` 的 testIgnore）：
 * 在工作台里遍历所有已注册主视觉，量出"图上各处能不能点到 img 本身"。
 *
 * ## 它产出的证据（2026-09-13 实测原文）
 *
 * ```
 * moon               100% 370x343   moon 系宇航员图（与业务无关的历史样本）
 * kindred            100% 415x425
 * tailwind-landing   100% 357x308
 * atlas              100% 744x236
 * astro-starter      100% 710x335
 * lonestone           75% 840x473   边缘 25% 被 null 覆盖
 * forge                0% 888x532   遮挡: DIV,H1   ← 全幅背景式 hero，点不到
 * landwind/foxi/yukina/fresh/screwfast  选择器在工作台上下文里无命中或命中 0×0
 * ```
 *
 * ⚠️ **裸预览页的可点比例**不等于**工作台里的**：`landwind` 在裸预览是 100%，
 * 进了工作台却不可用（选择器命中 0×0）。原 `tmp-asset.spec.ts` 就是只看了
 * 裸预览、没在工作台里验，才挑了实际点不到的模板。
 *
 * ## 用途
 *
 * - 为 `asset-select.spec.ts` 选目标模板提供**实测依据**（而不是挑顺眼的）；
 * - T-15 的影响面证据（哪些模板的主视觉用户点不到）。
 */
import { test } from "../helpers/fixtures";
import { createSite } from "../helpers/api";
import { getHeroAssets } from "../../lib/template-asset-registry.ts";

test("probe: 在工作台里遍历所有已注册主视觉，量可点比例", async ({ page, request }) => {
  test.setTimeout(300_000);
  const rows: string[] = [];
  for (const asset of getHeroAssets()) {
    if (!asset.selector) continue;
    let siteId: string;
    try {
      siteId = (await createSite(request, asset.templateId)).id;
    } catch {
      rows.push(`${asset.templateId.padEnd(18)} 建站失败`);
      continue;
    }
    await page.goto(`/workspace?siteId=${siteId}`);
    await page.getByRole("button", { name: "直接编辑" }).click().catch(() => {});
    await page.waitForTimeout(700);
    const frame = page.frameLocator("iframe");
    const info = await frame.locator("body").evaluate((_body, selector) => {
      const els = [...document.querySelectorAll(selector)] as HTMLElement[];
      const big = els.find((e) => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().height > 100) ?? els[0];
      if (!big) return { ok: false, why: "选择器无命中" };
      const r = big.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) {
        return { ok: false, why: `命中但太小 ${Math.round(r.width)}x${Math.round(r.height)}` };
      }
      let hits = 0;
      let total = 0;
      const blockers = new Set<string>();
      for (const fy of [0.2, 0.4, 0.6, 0.8]) {
        for (const fx of [0.15, 0.35, 0.5, 0.65, 0.85]) {
          const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy) as HTMLElement | null;
          total += 1;
          if (hit === big) hits += 1;
          else blockers.add(hit?.tagName ?? "null");
        }
      }
      return { ok: true, ratio: hits / total, rect: `${Math.round(r.width)}x${Math.round(r.height)}`, blockers: [...blockers].join(",") };
    }, asset.selector).catch((error: Error) => ({ ok: false, why: error.message.slice(0, 50) }));

    rows.push(
      info.ok
        ? `${asset.templateId.padEnd(18)} ${String(Math.round(info.ratio * 100)).padStart(3)}% ${info.rect} 遮挡:${info.blockers}`
        : `${asset.templateId.padEnd(18)} 不可用：${info.why}`,
    );
  }
  console.log("WORKSPACE-CLICKABLE\n" + rows.join("\n"));
});
