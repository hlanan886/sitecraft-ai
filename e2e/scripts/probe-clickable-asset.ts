/**
 * 只读探针：找一个"产品图**真的可点**"的真实模板（T-15 / 0.6-3）。
 *
 * ## 为什么需要探针（而不是挑一个顺眼的）
 *
 * 原 `tmp-asset.spec.ts` 想测"点产品图 → 弹素材选择"，但它挑的
 * `forge` 的 hero 图是**全幅背景图**——实测 `elementFromPoint` 在图的**每一个
 * 采样点**都返回覆盖其上的文字节点（`DIV.z-10` / `H1` / `H2` / `A`），
 * 图片**永远拿不到点击**。所以那条断言在 forge 上**结构上不可达**
 * （已登记 T-15：这类模板的用户点不到 hero 背景）。
 *
 * 本条探针换成**数据驱动**：遍历所有基线模板，找出"图上有点可打到 img 本身"
 * 的那些，用实测结果选目标，而不是凭直觉挑。
 *
 * 用法（需要 e2e 服务在场）：
 *   npx playwright test 之前先在脚本里起 serve，或用 `e2e/scripts/serve.mjs`
 *   node --experimental-strip-types e2e/scripts/probe-clickable-asset.ts
 */
import { chromium } from "playwright";
import { getTemplateManifest } from "../../lib/template-manifest.ts";
import { templates } from "../../lib/site-model.ts";
import { getHeroAssets } from "../../lib/template-asset-registry.ts";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3210";
const browser = await chromium.launch();
const page = await browser.newPage();

type Row = { id: string; target: string; ratio: number; samples: string[] };
const rows: Row[] = [];

for (const template of templates) {
  const manifest = getTemplateManifest(template.id);
  if (!manifest) continue;
  for (const entry of getHeroAssets().filter((item) => item.templateId === template.id)) {
    const url = `${BASE}/api/templates/${template.id}/preview`;
    try {
      await page.goto(url, { timeout: 20_000 });
    } catch {
      continue;
    }
    await page.waitForTimeout(400);
    const probe = await page.evaluate((selector) => {
      const img = document.querySelector(selector) as HTMLImageElement | null;
      if (!img) return null;
      const r = img.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return null;
      const samples: string[] = [];
      let hits = 0;
      let total = 0;
      for (const fy of [0.2, 0.4, 0.6, 0.8]) {
        for (const fx of [0.25, 0.5, 0.75]) {
          const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy) as HTMLElement | null;
          total += 1;
          if (el === img) hits += 1;
          samples.push(
            `${fx}/${fy}:${el === img ? "IMG" : (el?.tagName ?? "null")}`,
          );
        }
      }
      return { hitRatio: hits / total, samples: samples.filter((s) => !s.endsWith(":IMG")).slice(0, 4) };
    }, entry.selector);
    if (probe) rows.push({ id: template.id, target: "hero.image", ratio: probe.hitRatio, samples: probe.samples });
  }
}

await browser.close();

rows.sort((a, b) => b.ratio - a.ratio);
console.log(`共探测 ${rows.length} 个「模板 × 资产槽」组合`);
for (const row of rows) {
  console.log(`${row.id.padEnd(18)} ${row.target.padEnd(12)} 可点比例=${(row.ratio * 100).toFixed(0).padStart(3)}%  ${row.samples.join(" ")}`);
}
