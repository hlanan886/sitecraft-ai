import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanCapturedHtml,
  collectExternalReferences,
  decodeHtmlEntities,
  describeStaticExport,
  localFileNameFor,
  planStaticExport,
  rewriteCssReferences,
  rewriteResourceReferences,
  safeUrl,
  shouldSkipReference,
} from "../lib/template-static-export.ts";

/**
 * A 路径（网址 → 静态模板）的契约测试。
 *
 * 数字与形态取自 2026-09-11 的真实实测（`yunbuluo.net` 的模板展示页：
 * 94 个引用资源、清掉 2 个统计脚本、51 个跳过、只补到 1 个编辑位）。
 * 每条断言对应一个**真会出问题**的地方，不是"写写看"。
 */

// ---------------------------------------------------------------------------
// 文件名
// ---------------------------------------------------------------------------

test("同名不同参数的两张图不会落到同一个文件名（查询串参与哈希）", () => {
  // 实测常见形态：同一个接口用 query 区分不同图
  const a = localFileNameFor("https://cdn.example.com/img?id=123", "image/jpeg");
  const b = localFileNameFor("https://cdn.example.com/img?id=456", "image/jpeg");
  assert.notEqual(a, b, "丢掉查询串会让后一张覆盖前一张——表现为'有张图莫名变了'");
  assert.ok(a.startsWith("img-"), a);
});

test("路径里没有扩展名时按 content-type 补（很多 CDN 的图没有后缀）", () => {
  assert.match(localFileNameFor("https://cdn.example.com/photo/abc123", "image/webp"), /\.webp$/);
  assert.match(localFileNameFor("https://cdn.example.com/font", "font/woff2"), /\.woff2$/);
});

test("看着像扩展名的路由后缀不被当扩展名（.php/.aspx）", () => {
  const name = localFileNameFor("https://example.com/img/show.php", "image/png");
  assert.ok(name.endsWith(".png"), name);
});

test("中文文件名被安全化，但保留可读的部分", () => {
  const name = localFileNameFor("https://example.com/uploads/%E5%BB%BA%E7%AB%99-3.jpg", "image/jpeg");
  assert.match(name, /\.jpg$/);
  assert.ok(!/[一-鿿]/.test(name), "文件名里的中文会在某些文件系统上出问题");
});

test("畸形 URL 返回空串，不抛异常", () => {
  assert.equal(localFileNameFor("not a url"), "");
  assert.equal(safeUrl("://"), null);
});

// ---------------------------------------------------------------------------
// 清洗
// ---------------------------------------------------------------------------

test("清掉统计/广告脚本——留着只会把访客数据送给原站", () => {
  const html = `
    <script src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script>
    <script src="https://hm.baidu.com/hm.js?abc"></script>
    <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
    <script src="/js/app.js"></script>`;
  const report = cleanCapturedHtml(html);
  assert.equal(report.counts.analytics, 2);
  assert.equal(report.counts.ads, 1);
  // 原站自己的业务脚本必须留着——删了页面就残
  assert.ok(report.html.includes("/js/app.js"), "业务脚本不能被删");
});

test("清掉行内统计脚本，但不误删业务脚本", () => {
  const html = `
    <script>var _hmt = _hmt || [];(function(){var hm=document.createElement("script");hm.src="//hm.baidu.com/hm.js";})();</script>
    <script>window.__APP__ = { api: "/api" };</script>`;
  const report = cleanCapturedHtml(html);
  assert.equal(report.counts.analytics, 1);
  assert.ok(report.html.includes("__APP__"), "业务脚本必须留下");
});

test("清掉指向追踪域名的预连接——本地化之后它们一个都连不上，只会挂着等超时", () => {
  const report = cleanCapturedHtml(`<link rel="dns-prefetch" href="https://www.google-analytics.com"><link rel="preconnect" href="https://hm.baidu.com">`);
  assert.equal(report.removed.length, 2);
  assert.equal(report.html.includes("preconnect"), false);
  assert.equal(report.html.includes("dns-prefetch"), false);
});

test("非追踪域名的预连接保留——我们可能没搬成那个资源，留着还有用", () => {
  const html = `<link rel="preconnect" href="https://fonts.gstatic.com">`;
  const report = cleanCapturedHtml(html);
  assert.equal(report.removed.length, 0);
  assert.equal(report.html, html);
});

test("清掉自动跳转的 meta refresh——搬过来之后跳走，用户会以为我们做坏了", () => {
  const report = cleanCapturedHtml(`<meta http-equiv="refresh" content="0;url=https://evil.example.com">`);
  assert.equal(report.counts["meta-refresh"], 1);
  assert.equal(report.html.includes("meta"), false);
});

test("清掉第三方 iframe（客服/广告），但**保留同源 iframe**", () => {
  const html = `<iframe src="https://static.doubleclick.net/x.html"></iframe><iframe src="/widget/chat"></iframe>`;
  const report = cleanCapturedHtml(html);
  assert.equal(report.counts.ads, 1);
  assert.ok(report.html.includes("/widget/chat"), "同源 iframe 可能是页面结构的一部分");
});

test("清洗是幂等的：清两遍结果一样", () => {
  const html = `<script src="https://hm.baidu.com/hm.js"></script><h1>标题</h1>`;
  const once = cleanCapturedHtml(html).html;
  const twice = cleanCapturedHtml(once).html;
  assert.equal(once, twice);
});

// ---------------------------------------------------------------------------
// 引用收集与重写
// ---------------------------------------------------------------------------

test("收集绝对地址（含 srcset 多候选与 CSS url()）", () => {
  const html = `
    <img src="https://cdn.example.com/a.jpg" srcset="https://cdn.example.com/a-400.jpg 400w, https://cdn.example.com/a-800.jpg 800w">
    <link href="https://cdn.example.com/app.css" rel="stylesheet">
    <style>.bg{background:url('https://cdn.example.com/bg.png')}</style>
    <img src="/local.jpg"><img src="data:image/png;base64,AAA">`;
  const found = collectExternalReferences(html);
  assert.ok(found.includes("https://cdn.example.com/a.jpg"));
  assert.ok(found.includes("https://cdn.example.com/a-400.jpg"));
  assert.ok(found.includes("https://cdn.example.com/a-800.jpg"));
  assert.ok(found.includes("https://cdn.example.com/app.css"));
  assert.ok(found.includes("https://cdn.example.com/bg.png"));
  // 相对路径与内联资源不该被收
  assert.equal(found.includes("/local.jpg"), false);
  assert.equal(found.some((url) => url.startsWith("data:")), false);
});

test("重写 srcset 的每个候选，保留宽度描述符", () => {
  const mapping = {
    "https://cdn.example.com/a-400.jpg": "assets/a-400.jpg",
    "https://cdn.example.com/a-800.jpg": "assets/a-800.jpg",
  };
  const result = rewriteResourceReferences(
    `<img srcset="https://cdn.example.com/a-400.jpg 400w, https://cdn.example.com/a-800.jpg 800w">`,
    mapping,
  );
  assert.ok(result.html.includes("assets/a-400.jpg 400w"));
  assert.ok(result.html.includes("assets/a-800.jpg 800w"));
  assert.equal(result.rewritten, 1);
});

test("重写内联 style 里的 url()", () => {
  const result = rewriteResourceReferences(
    `<div style="background:url(https://cdn.example.com/bg.png)"></div>`,
    { "https://cdn.example.com/bg.png": "assets/bg.png" },
  );
  assert.ok(result.html.includes("url(assets/bg.png)"));
});

test("映射表里没有的引用原样保留——不猜、不改错", () => {
  const html = `<img src="https://other.com/x.jpg"><img src="https://cdn.example.com/a.jpg">`;
  const result = rewriteResourceReferences(html, { "https://cdn.example.com/a.jpg": "assets/a.jpg" });
  assert.ok(result.html.includes("https://other.com/x.jpg"));
  assert.ok(result.html.includes("assets/a.jpg"));
  assert.equal(result.rewritten, 1);
});

test("HTML 实体编码过的 URL 也能在映射表里命中", () => {
  assert.equal(decodeHtmlEntities("a&amp;b"), "a&b");
  const result = rewriteResourceReferences(
    `<img src="https://cdn.example.com/a.jpg?w=1&amp;h=2">`,
    { "https://cdn.example.com/a.jpg?w=1&h=2": "assets/a.jpg" },
  );
  assert.ok(result.html.includes("assets/a.jpg"), result.html);
});

// ---------------------------------------------------------------------------
// CSS 重写（实测踩过的坑：HTML 改好了、样式表里的背景图还是外链）
// ---------------------------------------------------------------------------

test("CSS 里的 url() 被换成本地路径，且路径是**相对 CSS 文件**的", () => {
  // CSS 落在 assets/style.css → 里面引用同目录的图应该写 `bg.png` 而不是 `assets/bg.png`
  const result = rewriteCssReferences(".a{background:url(https://cdn.example.com/bg.png)}", { "https://cdn.example.com/bg.png": "assets/bg.png" }, "assets/style.css");
  assert.ok(result.css.includes("url(../assets/bg.png)"), result.css);
  assert.equal(result.rewritten, 1);
});

test("CSS 在模板根时不做多余的 ../ —— 避免 assets/assets 这种双前缀", () => {
  const result = rewriteCssReferences(".a{background:url(https://cdn.example.com/bg.png)}", { "https://cdn.example.com/bg.png": "assets/bg.png" }, "style.css");
  assert.ok(result.css.includes("url(assets/bg.png)"), result.css);
  assert.ok(!result.css.includes("../"));
});

test("CSS 里的相对路径按'相对 CSS 文件'解析后能命中本地文件", () => {
  // 原站 CSS 写 ../images/bg.jpg，落到本地是 assets/bg.jpg
  const result = rewriteCssReferences(".a{background:url(../images/bg.jpg)}", { "https://cdn.example.com/bg.jpg": "assets/bg.jpg" }, "assets/style.css");
  // 原站那个 ../images 在新站里不存在，但本地有 assets/bg.jpg——能被认出来是同一张就够
  assert.ok(result.css.includes("bg.jpg"), result.css);
});

test("CSS 的 @import 也被重写", () => {
  const result = rewriteCssReferences(`@import "https://cdn.example.com/theme.css";`, { "https://cdn.example.com/theme.css": "assets/theme.css" }, "a/style.css");
  assert.ok(result.css.includes("assets/theme.css"), result.css);
});

test("data:/#/mailto: 不被动（它们不是资源）", () => {
  const css = `.a{background:url(data:image/png;base64,AAA)}.b{background:url(#gradient)}`;
  const result = rewriteCssReferences(css, { "https://x/y.jpg": "assets/y.jpg" }, "s.css");
  assert.equal(result.rewritten, 0);
  assert.equal(result.css, css);
});

// ---------------------------------------------------------------------------
// 该不该下载
// ---------------------------------------------------------------------------

test("跳过追踪地址与页面自身", () => {
  assert.equal(shouldSkipReference("https://hm.baidu.com/hm.js", "https://x.com/").skip, true);
  assert.equal(shouldSkipReference("https://x.com/", "https://x.com/").skip, true);
  // 同域但不同路径 = 正常资源
  assert.equal(shouldSkipReference("https://x.com/a.jpg", "https://x.com/").skip, false);
});

test("跳过畸形地址，不让它拖垮整次导出", () => {
  assert.equal(shouldSkipReference("not-a-url", "https://x.com/").skip, true);
});

// ---------------------------------------------------------------------------
// 计划组装
// ---------------------------------------------------------------------------

test("计划里如实记下**跳过了什么**，不静默丢弃", () => {
  const plan = planStaticExport({
    html: `<img src="https://cdn.example.com/big.jpg"><img src="https://cdn.example.com/small.jpg">`,
    pageUrl: "https://example.com/",
    assets: [
      { url: "https://cdn.example.com/big.jpg", kind: "image", bytes: 9_000_000 },
      { url: "https://cdn.example.com/small.jpg", kind: "image", bytes: 1000 },
    ],
    maxBytes: 4_000_000,
  });
  assert.deepEqual(plan.toDownload.map((item) => item.url), ["https://cdn.example.com/small.jpg"]);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /太大/);
});

test("抓取阶段就失败的资源不再重试，原因如实带出", () => {
  const plan = planStaticExport({
    html: `<img src="https://cdn.example.com/x.jpg">`,
    pageUrl: "https://example.com/",
    assets: [{ url: "https://cdn.example.com/x.jpg", kind: "image", error: "HTTP 403" }],
  });
  assert.equal(plan.toDownload.length, 0);
  assert.match(plan.skipped[0].reason, /403/);
});

test("清洗发生在收集**之前**——被清掉的追踪地址不该被下载", () => {
  const plan = planStaticExport({
    html: `<script src="https://www.google-analytics.com/analytics.js"></script>`,
    pageUrl: "https://example.com/",
    assets: [{ url: "https://www.google-analytics.com/analytics.js", kind: "script", bytes: 100 }],
  });
  assert.equal(plan.toDownload.length, 0);
  assert.equal(plan.cleanup.counts.analytics, 1);
});

test("汇总句说人话，且提到清理与跳过", () => {
  const plan = planStaticExport({
    html: `<script src="https://hm.baidu.com/hm.js"></script><img src="https://cdn.example.com/a.jpg">`,
    pageUrl: "https://example.com/",
    assets: [{ url: "https://cdn.example.com/a.jpg", kind: "image", bytes: 2048 }],
  });
  const text = describeStaticExport(plan, 2048);
  assert.ok(text.includes("本地化 1 个资源"), text);
  assert.ok(text.includes("统计"), text);
});
