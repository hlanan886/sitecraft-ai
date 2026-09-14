import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MAX_IMAGE_EDGE, WEBP_QUALITY, optimizeUploadedImage, describeOptimization } from "../lib/image-optimize.ts";

/**
 * 上传图瘦身的契约测试。
 *
 * 每个用例都对应一个**实测过的具体问题**（2026-09-11 盘点：
 * 12 张被引用的产品图占了 20.3MB，单张 1.7–2.3MB 的 PNG）。
 */

/**
 * 造一张"照片感"的大 PNG。
 *
 * ⚠️ **不能用纯噪声**。第一版用逐字节伪随机，结果 PNG 对噪声几乎压不动，
 * 转 WebP 反而更大——于是正确地走了"没收益就放行"的分支，
 * 测试断言 `optimized: true` 就失败了。**是测试数据不真实，不是实现错。**
 *
 * 真实照片/产品图是**低频渐变 + 局部细节**，PNG 压不好而 WebP 压得好。
 * 这里用正弦叠加造这种结构。
 */
async function noisyPng(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      // 低频渐变 + 一点确定性"细节"（高频但幅度小）——这才是照片的样子
      const base = Math.sin(x / 90) * 60 + Math.cos(y / 70) * 50 + 128;
      const detail = Math.sin(x / 3) * Math.cos(y / 4) * 14;
      raw[i] = Math.max(0, Math.min(255, base + detail));
      raw[i + 1] = Math.max(0, Math.min(255, base * 0.8 + 30 + detail));
      raw[i + 2] = Math.max(0, Math.min(255, base * 0.6 + 60 - detail));
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

test("大 PNG 被压成 WebP，尺寸也缩到上限内", async () => {
  const source = await noisyPng(3000, 2000);
  const result = await optimizeUploadedImage(source, "image/png");
  assert.equal(result.optimized, true);
  assert.equal(result.mime, "image/webp");
  assert.ok(result.savedBytes > 0);
  // 读**产物本身**核对尺寸——不信"sharp 说成功了"
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width ?? 0, meta.height ?? 0), MAX_IMAGE_EDGE);
});

test("小图不压——再压只会更糊，没有收益", async () => {
  const tiny = await noisyPng(80, 80);
  const result = await optimizeUploadedImage(tiny, "image/png");
  assert.equal(result.optimized, false);
  assert.equal(result.buffer, tiny);
  assert.match(result.reason ?? "", /够小/);
});

test("GIF 一律放行——sharp 只取第一帧，压了就是丢动效", async () => {
  const gif = await sharp({ create: { width: 800, height: 600, channels: 4, background: "#3a7" } }).gif().toBuffer();
  const result = await optimizeUploadedImage(gif, "image/gif");
  assert.equal(result.optimized, false);
  assert.match(result.reason ?? "", /动效/);
});

test("已经是 WebP 且够小的时候不重复压", async () => {
  // 造一张压过的 WebP：小尺寸 + 低质量
  const webp = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#48a" } })
    .webp({ quality: 40 })
    .toBuffer();
  const result = await optimizeUploadedImage(webp, "image/webp");
  // 小于 200KB 阈值 → 直接放行
  assert.equal(result.optimized, false);
});

test("透明区必须保留——产品图常是抠好的 PNG，压成 JPEG 会把透明变黑", async () => {
  // 半透明的红旗，压完 alpha 通道要还在
  const withAlpha = await sharp({
    create: { width: 1200, height: 800, channels: 4, background: { r: 200, g: 30, b: 40, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const result = await optimizeUploadedImage(withAlpha, "image/png");
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.hasAlpha, true, "压完必须还带 alpha 通道");
});

test("坏字节不抛异常——宁可存一张大图，也不能让上传失败", async () => {
  const garbage = Buffer.from("这不是图片".repeat(50_000));
  const result = await optimizeUploadedImage(garbage, "image/png");
  assert.equal(result.optimized, false);
  assert.equal(result.buffer, garbage, "压缩失败要原样返回");
  assert.ok(result.reason);
});

test("压缩后反而更大时保留原图（说明原图已经高度优化）", async () => {
  // 纯色大图：PNG 压得极好，转 WebP 可能更大
  const flat = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#fff" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const result = await optimizeUploadedImage(flat, "image/png");
  if (result.optimized) {
    assert.ok(result.buffer.length < flat.length, "说优化了就必须真的更小");
  } else {
    assert.equal(result.buffer, flat);
  }
});

test("汇总句说人话，且带具体数字", () => {
  const text = describeOptimization({ buffer: Buffer.alloc(0), mime: "image/webp", optimized: true, reason: "缩到 1600px 内并转 WebP", savedBytes: 2_200_000 });
  assert.ok(text.includes("1600px"), text);
  assert.ok(text.includes("2148KB"), text);
  const skipped = describeOptimization({ buffer: Buffer.alloc(0), mime: "image/png", optimized: false, reason: "本来就够小", savedBytes: 0 });
  assert.ok(skipped.includes("未压缩"), skipped);
});

test("质量参数是导出常量，改它要能被测试看见", () => {
  // 这两个值是实测定的（见模块头部的表格），不是随手写的
  assert.equal(WEBP_QUALITY, 82);
  assert.equal(MAX_IMAGE_EDGE, 1600);
});
