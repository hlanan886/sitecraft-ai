import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { rewriteTemplateRootRelativeReferences } from "../lib/template-static.ts";

const assetBase = "/api/templates/forge/assets/";

test("rewrites root-relative template resources in HTML island metadata", () => {
  const html = [
    '<script type="module" src="/_astro/ClientRouter.js"></script>',
    '<astro-island component-url="/_astro/nav.js" renderer-url="/_astro/client.js"></astro-island>',
    '<link rel="stylesheet" href="/_astro/About.css">',
    '<img src="/hero.webp">',
    '<a href="/Contact">Contact</a>',
  ].join(" ");

  const rewritten = rewriteTemplateRootRelativeReferences(html, "text/html; charset=utf-8", assetBase);

  assert.match(rewritten, /src="\/api\/templates\/forge\/assets\/_astro\/ClientRouter\.js"/);
  assert.match(rewritten, /component-url="\/api\/templates\/forge\/assets\/_astro\/nav\.js"/);
  assert.match(rewritten, /renderer-url="\/api\/templates\/forge\/assets\/_astro\/client\.js"/);
  assert.match(rewritten, /href="\/api\/templates\/forge\/assets\/_astro\/About\.css"/);
  assert.match(rewritten, /src="\/api\/templates\/forge\/assets\/hero\.webp"/);
  assert.match(rewritten, /<a href="\/Contact">Contact<\/a>/);
});

test("rewrites root-relative resources inside CSS and JavaScript assets", () => {
  const css = ".hero{background:url('/hero.webp')}@font-face{src:url(/_astro/font.woff2)}";
  const js = 'const next = import("/_astro/client.js"); fetch("/_astro/data.json");';

  assert.equal(
    rewriteTemplateRootRelativeReferences(css, "text/css; charset=utf-8", assetBase),
    ".hero{background:url('/api/templates/forge/assets/hero.webp')}@font-face{src:url(/api/templates/forge/assets/_astro/font.woff2)}",
  );
  assert.equal(
    rewriteTemplateRootRelativeReferences(js, "text/javascript; charset=utf-8", assetBase),
    'const next = import("/api/templates/forge/assets/_astro/client.js"); fetch("/api/templates/forge/assets/_astro/data.json");',
  );
});

test("does not rewrite external, data, hash, or application API URLs", () => {
  const source = [
    "url(https://cdn.example.com/image.webp)",
    "url(data:image/svg+xml;base64,abc)",
    "url(#mask)",
    "url(/api/templates/forge/assets/icon.svg)",
    "url(/api/sites/current)",
    "url(//cdn.example.com/image.webp)",
  ].join(" ");

  assert.equal(
    rewriteTemplateRootRelativeReferences(source, "text/css; charset=utf-8", assetBase),
    source,
  );
});

test("template bridge reapplies the active draft before exporting offline HTML", async () => {
  // B4（2026-09-13）：注入桥从 route.ts 搬到独立模块，本断言的三处正则
  // 全部命中的是桥脚本内部——**锚点必须跟人走**。若仍读老路径，
  // 三条正则会在一个已无这些符号的文件上失败（而不是静默通过，这点还算好）。
  const source = await readFile(new URL("../lib/template-preview-bridge.ts", import.meta.url), "utf8");
  assert.match(source, /let activeDraft = null/);
  // 2026-09-11（⑥）：赋值处多包了一层 `withNavigationView`——导航数组化后，
  // 21 个适配器仍需按 id 索引读导航，兼容视图必须套在**赋值处**
  // （适配器读的是全局 activeDraft，包在调用处无效）。
  // 断言放宽成"赋值自 event.data.draft"，本意（导出前重放当前草稿）不变。
  assert.match(source, /activeDraft = withNavigationView\(event\.data\.draft/);
  assert.match(source, /await applyContent\(activeDraft, activeLocale, activeExpectedTargets, activeVariant\)/);
});

// ---- 2026-09-09：JS 字符串字面量 / 内联 CSS url() / 无前导斜杠路径 ----
// 背景：Astro/Vite 构建产物把资源写成纯字符串或相对路径，<base> 管不到独立 JS 资源，
// 实测导致 6 个模板资源 404（yukina 8 处最严重）。以下用例锁住新规则，防止回归或误伤。

test("rewrites root-relative asset paths inside JS string literals", () => {
  const js = 'const a={src:"/assets/pilot.png"};const b="/_astro/bg.webp";const c=\'/images/x.jpg\';';
  assert.equal(
    rewriteTemplateRootRelativeReferences(js, "text/javascript; charset=utf-8", assetBase),
    'const a={src:"/api/templates/forge/assets/assets/pilot.png"};const b="/api/templates/forge/assets/_astro/bg.webp";const c=\'/api/templates/forge/assets/images/x.jpg\';',
  );
});

test("rewrites url() inside inline style blocks embedded in HTML", () => {
  const html = '<style>@font-face{src:url("/_astro/fonts/f.woff2")}</style>';
  assert.match(
    rewriteTemplateRootRelativeReferences(html, "text/html; charset=utf-8", assetBase),
    /url\("\/api\/templates\/forge\/assets\/_astro\/fonts\/f\.woff2"\)/,
  );
});

test("rewrites leading-slash-less relative asset paths (vite __vite__mapDeps)", () => {
  // 实测来源：yukina dist/_astro/page.*.js 的 m.f||(m.f=["_astro/Swup.js",...])
  const js = '__vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_astro/Swup.js","_astro/index.modern.js"])))';
  assert.equal(
    rewriteTemplateRootRelativeReferences(js, "text/javascript; charset=utf-8", assetBase),
    '__vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["/api/templates/forge/assets/_astro/Swup.js","/api/templates/forge/assets/_astro/index.modern.js"])))',
  );
});

test("leaves plain prose and non-resource paths untouched", () => {
  const source = '见 /about 页面；路径 /assets 目录；相对引用 "./local.js" 与 "../up.png" 不变';
  assert.equal(
    rewriteTemplateRootRelativeReferences(source, "text/html; charset=utf-8", assetBase),
    source,
  );
});

test("does not double-rewrite an already rewritten path", () => {
  const once = rewriteTemplateRootRelativeReferences(
    'const u="/assets/pilot.png";',
    "text/javascript; charset=utf-8",
    assetBase,
  );
  assert.equal(once, 'const u="/api/templates/forge/assets/assets/pilot.png";');
  // 再跑一遍必须保持不变（负向断言排除 /api/）
  assert.equal(rewriteTemplateRootRelativeReferences(once, "text/javascript; charset=utf-8", assetBase), once);
});
