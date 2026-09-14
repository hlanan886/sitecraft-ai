/**
 * 只读探针：穷举 22 个基线模板的入口 HTML，找出**自带内联脚本**的那些。
 *
 * ## 为什么要它
 *
 * `localPreviewCsp()`（`app/api/templates/[templateId]/preview/route.ts:35`）在
 * **production** 下只给桥接脚本发 nonce，模板自带的内联脚本一律被 CSP 拦。
 * 对**需要 JS 才能渲染**的模板（Next.js 导出站），结果是 hydration 失败、白屏。
 *
 * 这条探针把"1 条失败的 e2e 用例"变成"**已知影响面清单**"（T-14）。
 *
 * ## 判定口径
 *
 * - **内联脚本**：`<script>` 无 `src` 且非空（含 `type="module"` / `application/json`
 *   之类不一概算——见下方分类）。
 * - **会挂**：模板**依赖**这些内联脚本渲染。最强的信号是"Next.js 导出站"
 *   （`__NEXT_DATA__` / `self.__next_f`），那种站没有内联 bootstrap 就是白屏。
 *   Astro 站通常内容已在 HTML 里，内联脚本多是增强，**拦了不白屏**——单独归类。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { templates } from "../../lib/site-model.ts";

type Hit = {
  id: string;
  localPath: string;
  file: string;
  inlineScripts: number;
  /** 需要 JS 才能出内容的最强信号 */
  nextHydration: boolean;
  astroIsland: boolean;
  jsonLdOnly: boolean;
};

function scanFile(id: string, localPath: string, file: string): Hit | null {
  if (!existsSync(file)) return null;
  const html = readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let inlineScripts = 0;
  let jsonLdOnly = true;
  for (const [, attrs, body] of scripts) {
    if (/\bsrc\s*=/.test(attrs)) continue; // 外链脚本，被 'self' 放行
    if (!body.trim()) continue;
    inlineScripts += 1;
    if (!/type\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs)) jsonLdOnly = false;
  }
  return {
    id,
    localPath,
    file: path.relative(process.cwd(), file),
    inlineScripts,
    nextHydration: /__NEXT_DATA__|self\.__next_f|__next_f\.push/.test(html),
    astroIsland: /astro-island|astro-slot|data-astro-/.test(html),
    jsonLdOnly: inlineScripts > 0 && jsonLdOnly,
  };
}

const results: Hit[] = [];
for (const template of templates) {
  for (const candidate of [`${template.source.localPath}/dist/index.html`, `${template.source.localPath}/index.html`]) {
    const hit = scanFile(template.id, template.source.localPath, path.resolve(process.cwd(), candidate));
    if (hit) {
      results.push(hit);
      break;
    }
  }
}

const withInline = results.filter((row) => row.inlineScripts > 0);
const risk = results.filter((row) => row.inlineScripts > 0 && !row.jsonLdOnly);
const safe = results.filter((row) => row.inlineScripts === 0 || row.jsonLdOnly);

console.log("TOTAL", results.length, "| 有内联脚本", withInline.length, "| 其中非纯 JSON-LD（生产预览会被拦且可能影响渲染）", risk.length);
console.log("");
console.log("=== 风险清单（内联脚本非纯 JSON-LD）===");
for (const row of risk) {
  console.log(
    `${row.id.padEnd(20)} inline=${String(row.inlineScripts).padStart(2)} nextHydration=${row.nextHydration ? "YES" : "no "} astro=${row.astroIsland ? "yes" : "no "} ← ${row.file}`,
  );
}
console.log("");
console.log("=== 仅 JSON-LD（拦了不影响渲染）===");
console.log(safe.map((row) => row.id).join(", ") || "（无）");
console.log("");
console.log("=== 覆盖不到入口 HTML 的模板 ===");
const missing = templates.filter((template) => !results.some((row) => row.id === template.id));
console.log(missing.map((template) => `${template.id}(${template.source.localPath})`).join(", ") || "（无）");
