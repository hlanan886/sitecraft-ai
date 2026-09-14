/**
 * 上传图片的**瘦身**（`sharp`，重依赖层）。
 *
 * ## 为什么需要（2026-09-11 实测）
 *
 * 盘点 `.sitecraft-data/uploads` 发现：42 张图 / **23.8MB**，
 * 其中**真正被站点引用的只有 12 张，却占了 20.3MB**——
 * 因为上游直接把原图存了下来：`hy-depc-100.png` **2.28MB**、
 * `hy-ess-200.png` **1.84MB**……
 *
 * 那些是**产品卡图**（展示尺寸约 400×300）。访客打开站点要下十几 MB 的图，
 * 首屏直接卡住。这不是"优化"，是**功能缺陷**。
 *
 * ## 参数怎么定的（不是拍的）
 *
 * | 参数 | 值 | 依据 |
 * |---|---|---|
 * | 最长边 | **1600px** | 产品卡展示宽度 ≤600px，2× 屏 1200px；留到 1600 给放大留余量，再大对肉眼无差别 |
 * | 格式 | **WebP** | 项目已依赖 sharp（`site-capture-browser.ts` 在用），WebP 同画质比 JPEG 小 25–35% |
 * | 质量 | **82** | sharp 的 WebP q82 在常规照片上肉眼无损；q90 体积翻倍而看不出差别 |
 * | 透明 | **保留** | 产品图常是抠好的 PNG。压成 JPEG 会把透明区变黑——**这是"压坏了"，不是"压小了"** |
 *
 * ## 什么时候**不压**
 *
 * - 已经比目标还小：再压只会更糊，没有收益；
 * - 动图（`image/gif`）：sharp 只能取第一帧，压完**动效没了**——那是功能损失；
 * - SVG 不进这里（上传白名单已拒绝）。
 *
 * ## 永不抛异常
 *
 * 压缩失败一律**回退原图**。宁可存一张大图，也不能因为"优化"而让上传失败——
 * 用户传不上去比图大严重得多。
 */
import sharp from "sharp";

/** 压缩结果。`optimized: false` 表示原样保留（附原因）。 */
export type OptimizeResult = {
  buffer: Buffer;
  mime: string;
  optimized: boolean;
  reason?: string;
  /** 省下的字节数（负数表示反而变大了） */
  savedBytes: number;
};

export const MAX_IMAGE_EDGE = 1600;
export const WEBP_QUALITY = 82;

/** 低于这个体积就不折腾了——再压收益微乎其微，还要冒压糊的风险。 */
const MIN_BYTES_TO_BOTHER = 200 * 1024;

/** 不会保留动效的格式：压了就是功能损失，直接放行。 */
const ANIMATED_MIME = ["image/gif"];

export async function optimizeUploadedImage(buffer: Buffer, mime: string): Promise<OptimizeResult> {
  const passthrough = (reason: string): OptimizeResult => ({
    buffer,
    mime,
    optimized: false,
    reason,
    savedBytes: 0,
  });

  if (ANIMATED_MIME.includes(mime)) {
    return passthrough("GIF 可能带动效，压缩会丢帧");
  }
  if (buffer.length < MIN_BYTES_TO_BOTHER) {
    return passthrough("本来就够小");
  }

  try {
    const image = sharp(buffer, { failOn: "none" });
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) return passthrough("读不出尺寸");

    const longest = Math.max(width, height);
    const needsResize = longest > MAX_IMAGE_EDGE;
    // 已经够小**且**已经是我们会输出的大小附近的 PNG/JPEG，仍然压一次 WebP——
    // "文件不大"不等于"对网页友好"，2MB 的 PNG 换成 WebP 常常只剩 300KB。
    // 但如果原图本来就很紧凑（JPEG 且 <500KB），压了收益很小，放行更稳。

    let pipeline = sharp(buffer, { failOn: "none" });
    if (needsResize) {
      pipeline = pipeline.resize({
        width: width >= height ? MAX_IMAGE_EDGE : undefined,
        height: height > width ? MAX_IMAGE_EDGE : undefined,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    // `withMetadata()` 保留 EXIF 方向与色彩配置——手机拍的图常有旋转标记，
    // 去掉它会让图片在站上**躺倒**（这是"压坏了"的另一种形态）。
    const output = await pipeline.withMetadata().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();

    // 压完反而更大：说明原图已经是高度优化的格式，别折腾
    if (output.length >= buffer.length) {
      return passthrough("压缩后反而更大，保留原图");
    }

    return {
      buffer: output,
      mime: "image/webp",
      optimized: true,
      reason: needsResize ? `缩到 ${MAX_IMAGE_EDGE}px 内并转 WebP` : "转为 WebP",
      savedBytes: buffer.length - output.length,
    };
  } catch (error) {
    // 永不因为"优化"让上传失败
    return passthrough(`压缩失败（${error instanceof Error ? error.message : "未知"}），保留原图`);
  }
}

/** 给用户/日志看的一句话。 */
export function describeOptimization(result: OptimizeResult): string {
  if (!result.optimized) return `未压缩：${result.reason ?? "无收益"}`;
  const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;
  return `${result.reason}：省下 ${kb(result.savedBytes)}`;
}
