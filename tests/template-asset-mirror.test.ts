import assert from "node:assert/strict";
import test from "node:test";

import {
  MIRROR_PATH_SEGMENT,
  mirroredAssetEntries,
  mirroredAssetPath,
  mirroredAssetsHealth,
  readMirroredTemplateAsset,
  rewriteExternalResourceReferences,
} from "../lib/template-asset-mirror.ts";

/**
 * 境外资源本地化（方向 1，2026-09-10 扩展到图片）。
 *
 * 背景：此前镜像机制只覆盖 `<link>`/`<script>`、只登记 1 个文件、
 * content-type 还会让图片被浏览器拒绝渲染（`application/octet-stream` + `nosniff`）。
 * 国内网络下 lonestone(astrowind) / shadcn-landing2 / yukina 的首页图片全部来自境外 CDN。
 */

test("镜像体检：登记的资源必须都已落盘", () => {
  const health = mirroredAssetsHealth();
  assert.deepEqual(
    health.missing,
    [],
    `有登记但未落盘（用户会看到破图）：${health.missing.map((m) => `${m.templateId}/${m.file}`).join(", ")}`,
  );
});

test("前缀匹配：同一张图的不同尺寸变体都命中同一本地文件", () => {
  // Unsplash 把尺寸写在 query 里；按去 query 的前缀匹配才能一个文件覆盖全部尺寸
  const small = "https://images.unsplash.com/photo-1516996087931-5ae405802f9f?w=400&h=225&q=80";
  const large = "https://images.unsplash.com/photo-1516996087931-5ae405802f9f?w=1600&h=900&q=80";
  assert.ok(mirroredAssetPath("lonestone", small), "小尺寸应命中");
  assert.equal(
    mirroredAssetPath("lonestone", small),
    mirroredAssetPath("lonestone", large),
    "同一张图的不同尺寸必须指向同一文件",
  );
});

test("重写：<img> 的绝对外链被替换（此前完全不处理 img）", () => {
  const html = '<img src="https://images.unsplash.com/photo-1516996087931-5ae405802f9f?w=640&h=360&q=80" alt="x">';
  const out = rewriteExternalResourceReferences(html, "lonestone");
  assert.ok(!out.includes("unsplash.com"), "不应残留境外 URL");
  assert.ok(out.includes(`${MIRROR_PATH_SEGMENT}/photo-1516996087931-5ae405802f9f.jpg`), "应指向本地镜像路径");
  // 属性形态不应被破坏。注意路径里的模板 id 是 **catalog id**（lonestone），
  // 而不是 vendor 目录名（astrowind）——两者不一致，写错会导致运行时静默不替换。
  assert.match(out, /^<img src="\/api\/templates\/lonestone\/assets\/__mirror__\/[^"]+" alt="x">$/);
});

test("重写：srcset 的每个候选都被替换，且保留 width 描述符", () => {
  const html = '<img srcset="https://images.unsplash.com/photo-1516996087931-5ae405802f9f?w=400 400w, https://images.unsplash.com/photo-1516996087931-5ae405802f9f?w=900 900w">';
  const out = rewriteExternalResourceReferences(html, "lonestone");
  assert.ok(!out.includes("unsplash.com"));
  assert.match(out, /400w/);
  assert.match(out, /900w/);
  // 逗号分隔结构保留（两个候选）
  assert.equal(out.split("__mirror__").length - 1, 2, "两个候选都应被重写");
});

test("重写：未登记的模板/URL 原样返回，不误伤", () => {
  const html = '<img src="https://images.unsplash.com/photo-9999999999999-abcdef">';
  assert.equal(rewriteExternalResourceReferences(html, "lonestone"), html, "未登记的图不应被改写");
  assert.equal(rewriteExternalResourceReferences(html, "forge"), html, "未登记镜像的模板应原样返回");
  assert.equal(rewriteExternalResourceReferences("<img src=\"/local.jpg\">", "lonestone"), "<img src=\"/local.jpg\">", "同源路径不该被动");
});

test("读取镜像资源返回正确的 content-type（此前图片一律 octet-stream，会被 nosniff 拒绝渲染）", async () => {
  const css = await readMirroredTemplateAsset("tailwind-landing", ["tailwind.min.css"]);
  assert.ok(css, "已登记的 CSS 应能读取");
  assert.match(css.contentType, /text\/css/);

  const image = await readMirroredTemplateAsset("lonestone", ["photo-1516996087931-5ae405802f9f.jpg"]);
  assert.ok(image, "已登记的图片应能读取");
  assert.match(image.contentType, /image\/jpeg/, "图片必须返回图片 content-type");
  assert.ok(image.body.length > 0);
});

test("读取镜像资源 fail-closed：未登记的文件/穿越路径返回 null", async () => {
  assert.equal(await readMirroredTemplateAsset("lonestone", ["../../package.json"]), null);
  assert.equal(await readMirroredTemplateAsset("lonestone", ["not-registered.jpg"]), null);
  assert.equal(await readMirroredTemplateAsset("forge", ["tailwind.min.css"]), null, "未登记镜像的模板应返回 null");
  assert.equal(await readMirroredTemplateAsset("lonestone", []), null);
});

test("登记表非空且每个模板都有可读条目", () => {
  for (const templateId of ["tailwind-landing", "lonestone", "shadcn-landing2", "yukina"]) {
    const entries = mirroredAssetEntries(templateId);
    assert.ok(entries.length > 0, `${templateId} 应有镜像条目`);
    for (const entry of entries) {
      assert.ok(entry.urlPrefix.startsWith("http"), "urlPrefix 应是绝对 URL 前缀");
      assert.ok(entry.file && !entry.file.includes(".."), "file 应是安全的相对路径");
    }
  }
});

test("重写：已镜像域名的 preconnect 预热标签被移除（国内连不上会挂起）", () => {
  const html = '<link href="https://images.unsplash.com" rel="preconnect">'
    + '<link href="https://fonts.googleapis.com" rel="preconnect">';
  const out = rewriteExternalResourceReferences(html, "lonestone");
  assert.ok(!out.includes("images.unsplash.com"), "已镜像域名的预热应移除");
  assert.ok(out.includes("fonts.googleapis.com"), "未镜像的域名不应被误删");
});

test("重写：yukina 的 data-background-image 也被覆盖（lozad 懒加载背景图）", () => {
  const html = '<li data-background-image="https://s2.loli.net/2025/01/25/6bKcwHZigzlM4mJ.webp"></li>';
  const out = rewriteExternalResourceReferences(html, "yukina");
  assert.ok(!out.includes("s2.loli.net"), "背景图属性也应被本地化");
  assert.ok(out.includes("__mirror__/6bKcwHZigzlM4mJ.webp"));
});
