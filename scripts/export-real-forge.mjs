import fs from "node:fs";

// ===== 配置 =====
const SITE_ID = "80009412-ffb5-4a38-8a8d-931070973bdf";
const TEMPLATE_ID = "forge";
const OUT = "D:/sitecraft-ai/成品展示/恒固精工-SMALLBIS真实模板.html";
const API = "http://localhost:3000";
const AB = `/api/templates/${TEMPLATE_ID}/assets/`;

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff" };
const fetchBuf = async (url) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};
const extOf = (p) => p.split("?")[0].split("#")[0].split(".").pop().toLowerCase();

console.log("1. 抓取真实模板 HTML…");
let html = (await fetchBuf(`${API}/api/templates/${TEMPLATE_ID}/preview?v=export`)).toString("utf8");

// 2. 先抓 CSS 文本（供内联），并处理其内部 url()
let cssText = null;
{
  const m = html.match(/href="(\/api\/templates\/forge\/assets\/_astro\/[^"]*\.css)"/);
  if (m) cssText = (await fetchBuf(`${API}${m[1]}`)).toString("utf8");
}
if (cssText) {
  // CSS url(/xxx) → data uri
  const urlRe = /url\(\s*["']?(\/[^)"']+)["']?\s*\)/g;
  const seen = new Set();
  let um;
  while ((um = urlRe.exec(cssText))) seen.add(um[1]);
  for (const u of seen) {
    const plain = u.split("?")[0].split("#")[0];
    const ext = extOf(plain);
    if (!MIME["." + ext]) continue;
    try {
      const buf = await fetchBuf(`${API}${AB}${plain.replace(/^\//, "")}`);
      const uri = `data:${MIME["." + ext]};base64,${buf.toString("base64")}`;
      cssText = cssText.split(`url(${u})`).join(`url("${uri}")`).split(`url("${u}")`).join(`url("${uri}")`).split(`url('${u}')`).join(`url("${uri}")`);
      console.log(`  CSS url → ${plain}`);
    } catch { console.log(`  CSS url 缺失: ${plain}`); }
  }
}

// 3. 标签级替换
// 3a. <link rel="stylesheet" href="...css"> → <style>...</style>
if (cssText) {
  html = html.replace(/<link rel="stylesheet" href="[^"]*\.css"[^>]*>/g, `<style>${cssText}</style>`);
}
// 3b. <link rel="preload" href="...img"> → 移除（图片由 src 或 CSS 内联提供）
html = html.replace(/<link rel="preload"[^>]*>/g, "");
// 3c. <link rel="icon" href="...svg"> → 保留 data uri 版
{
  const m = html.match(/<link rel="icon"[^>]*href="(\/api\/templates\/forge\/assets\/[^"]*)"[^>]*>/);
  if (m) {
    const ext = extOf(m[1]);
    if (MIME["." + ext]) {
      const buf = await fetchBuf(`${API}${m[1]}`);
      html = html.replace(m[0], `<link rel="icon" href="data:${MIME["." + ext]};base64,${buf.toString("base64")}">`);
    }
  }
}
// 3d. <script type="module" src="...js"> → 内嵌 JS（保留 module 语义）
{
  const re = /<script type="module" src="(\/api\/templates\/forge\/assets\/_astro\/[^"]*\.js)"[^>]*>\s*<\/script>/g;
  let sm;
  const jsList = [];
  while ((sm = re.exec(html))) jsList.push(sm[1]);
  for (const jsUrl of jsList) {
    const code = (await fetchBuf(`${API}${jsUrl}`)).toString("utf8");
    html = html.split(`<script type="module" src="${jsUrl}">\n</script>`).join(`<script type="module">${code}</script>`);
    html = html.split(`<script type="module" src="${jsUrl}"></script>`).join(`<script type="module">${code}</script>`);
    console.log(`  内联 module: ${jsUrl.split("/").pop()}`);
  }
}
// 3e. 图片 src/href：src="...jpg/webp/svg" → data uri（逐个替换值，不破坏标签）
{
  const re = /(src|href)="(\/api\/templates\/forge\/assets\/[^"]*(?:\.jpg|\.jpeg|\.png|\.webp|\.svg))"/g;
  const seen = new Set();
  let im;
  while ((im = re.exec(html))) seen.add(im[2]);
  for (const rel of seen) {
    const ext = extOf(rel);
    if (!MIME["." + ext]) continue;
    try {
      const buf = await fetchBuf(`${API}${rel}`);
      const uri = `data:${MIME["." + ext]};base64,${buf.toString("base64")}`;
      html = html.split(`"${rel}"`).join(`"${uri}"`);
      console.log(`  图片 → ${rel.split("/").pop()} (${buf.length})`);
    } catch { console.log(`  图片缺失: ${rel}`); }
  }
}

// 4. 导航去绝对化 + 去掉 base
html = html.replace(/href="\/api\/templates\/forge\/assets\/(About|Services|Reviews|Contact|FAQ)"/g, 'href="#top"');
html = html.replace(/href="\/api\/templates\/forge\/assets\/"/g, 'href="#top"');
html = html.replace(/<base href="[^"]*">/g, "");

// 4.5 FAQ island：整体替换为静态 FAQ（不依赖 Radix hydration，单文件可直接展开阅读）
const FAQ_HTML = `<div id="FAQ" class="mx-6 mt-60 flex flex-col items-center justify-center text-xl md:mx-40"><h1 class="mb-10 text-center text-4xl md:text-left" style="color:var(--main-color,inherit)">常见问题 / FAQ</h1>
<div class="w-full text-left" style="max-width:860px">
<div class="border-b py-5"><h3 class="text-xl font-semibold">你们能按图纸定制非标件吗？</h3><p class="mt-2 text-base opacity-75">可以。我们提供非标 CNC 精密加工，接受客户图纸与样品，材料、公差与表面处理均可按需定制。</p></div>
<div class="border-b py-5"><h3 class="text-xl font-semibold">最小起订量是多少？</h3><p class="mt-2 text-base opacity-75">常规件支持小批量试单；批量生产视规格与工艺而定，欢迎提供图纸获取快速报价。</p></div>
<div class="border-b py-5"><h3 class="text-xl font-semibold">如何保证质量？</h3><p class="mt-2 text-base opacity-75">从材料入库到出货全程检验，关键尺寸全检并出具检测报告，质量可追溯。</p></div>
<div class="border-b py-5"><h3 class="text-xl font-semibold">交付周期多久？</h3><p class="mt-2 text-base opacity-75">常规件 7-15 天，定制件视复杂程度 15-30 天，具体以确认为准。</p></div>
</div></div>`;
// 匹配 FAQ astro-island（含其内部全部子节点到闭合 island 标签）
html = html.replace(/<astro-island[^>]*component-url="[^"]*faq\.DdY4n_PA\.js"[^>]*>[\s\S]*?<\/astro-island>/, FAQ_HTML);
// 4.6 移除 astro-island 的客户端脚本属性（保留 SSR 静态内容，避免 file:// 下 CORS 报错）
html = html.replace(/<astro-island\b/g, "<div data-astro-static");
html = html.replace(/<\/astro-island>/g, "</div>");
// 移除 component-url/renderer-url/await-children 等 astro 专用属性
html = html.replace(/\s+(component-url|renderer-url|component-export|renderer-url|props|ssr|client|opts|await-children|uid|prefix)="[^"]*"/g, "");
// 移除 ClientRouter 内联脚本中对 _astro chunk 的动态 import 引用（已静态化，不再需要 SPA 导航）
html = html.replace(/<script type="module">[\s\S]*?ClientRouter[\s\S]*?<\/script>/g, "");
html = html.replace(/123 Company street[\s\S]{0,20}?12345/g, "No. 88 Innovation Road, Suzhou Industrial Park, China");
html = html.replace(/Company@email\.com/g, "info@henggu-precision.com");
html = html.replace(/000-000-0000/g, "+86 512 8888 6666");
html = html.replace(/Designed by Dillonpw[\s\S]{0,30}/g, "HengGu Precision © 2026 · Built with SiteCraft AI");

// 5. 注入恒固精工内容（bridge 自动触发）
const { draft } = await (await fetch(`${API}/api/sites/${SITE_ID}/draft`, { cache: "no-store" })).json();
const draftJson = JSON.stringify(draft).replace(/</g, "\\u003c");
html = html.replace(/<\/body>/i, `<script>
(function () {
  var draft = ${draftJson};
  var fire = function () { window.postMessage({ type: "sitecraft:content", templateId: "${TEMPLATE_ID}", draft: draft, locale: "zh", expectedTargets: [], variant: "published" }, "*"); };
  window.addEventListener("message", function (e) { if (e.data && e.data.type === "sitecraft:ready") fire(); });
  setTimeout(fire, 400); setTimeout(fire, 1200); setTimeout(fire, 3000); setTimeout(fire, 7000);
})();
<\/script></body>`);

fs.writeFileSync(OUT, html, "utf8");
console.log("✅ 生成:", OUT, "(", fs.statSync(OUT).size, "bytes )");
