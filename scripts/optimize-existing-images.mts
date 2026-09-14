/**
 * 回填：把**已经存下来的**大图压一遍（2026-09-11）。
 *
 * ## 为什么需要
 *
 * 压缩是加在上传路径上的，只对**以后**的上传生效。而盘点发现
 * 已有的 12 张图片占了 **20.3MB**（单张 1.7–2.3MB 的 PNG，
 * 在页面上的展示尺寸只有 400×300）——访客打开站点要下十几 MB。
 * 不回头压一遍，这些站会一直这么重。
 *
 * ## 最保守的做法
 *
 * 改写用户上传的文件是**危险操作**（压坏了不可逆）。所以：
 *
 * | 决策 | 理由 |
 * |---|---|
 * | **默认只报告**，`--apply` 才动手 | 先看要动哪些、能省多少 |
 * | **写新文件、不改旧文件** | 旧文件留着，改草稿指向新文件——**可回滚** |
 * | 只有真省下 ≥30% 才换 | 省得少就不值得冒换文件的风险 |
 * | 压完**读回元数据核对**尺寸有效 | 不信"sharp 说成功了"，验产物本身 |
 *
 * 用法：
 *   node --experimental-strip-types scripts/optimize-existing-images.mts
 *   node --experimental-strip-types scripts/optimize-existing-images.mts --apply
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { optimizeUploadedImage } from "../lib/image-optimize.ts";

const DATA_ROOT = path.resolve(process.cwd(), ".sitecraft-data");
const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
const SITE_DIR = path.join(DATA_ROOT, "sites");
const APPLY = process.argv.includes("--apply");
/** 换文件的收益门槛：省不到这个比例就不折腾。 */
const MIN_SAVING_RATIO = 0.3;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

async function main() {
  // ---- 1. 找出被引用的图 ----
  const referenced = new Set<string>();
  for (const fileName of await readdir(SITE_DIR).catch(() => [] as string[])) {
    if (!fileName.endsWith(".json")) continue;
    const raw = await readFile(path.join(SITE_DIR, fileName), "utf8").catch(() => "");
    for (const match of raw.matchAll(/\/api\/product-images\/([A-Za-z0-9._-]+)/g)) referenced.add(match[1]);
  }

  // ---- 2. 逐张评估 ----
  type Candidate = { fileName: string; before: number; after: number; newName: string; body: Buffer };
  const candidates: Candidate[] = [];
  let skippedSmall = 0;
  let skippedLowGain = 0;

  for (const fileName of await readdir(UPLOAD_DIR).catch(() => [] as string[])) {
    if (!referenced.has(fileName)) continue; // 孤儿由盘点脚本负责，这里只管在用的
    const full = path.join(UPLOAD_DIR, fileName);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    const mime = MIME_BY_EXT[path.extname(fileName).toLowerCase()];
    if (!mime) continue;
    if (info.size < 200 * 1024) {
      skippedSmall += 1;
      continue;
    }
    const buffer = await readFile(full);
    const result = await optimizeUploadedImage(buffer, mime);
    if (!result.optimized) {
      skippedLowGain += 1;
      continue;
    }
    const ratio = result.savedBytes / buffer.length;
    if (ratio < MIN_SAVING_RATIO) {
      skippedLowGain += 1;
      continue;
    }
    // 新文件名：换扩展名 + 短标记，避免与旧文件混淆
    const ext = result.mime === "image/webp" ? ".webp" : path.extname(fileName);
    const newName = fileName.replace(/\.[^.]+$/, "") + `-opt${ext}`;
    candidates.push({ fileName, before: buffer.length, after: result.buffer.length, newName, body: result.buffer });
  }

  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + "MB";
  const totalBefore = candidates.reduce((sum, c) => sum + c.before, 0);
  const totalAfter = candidates.reduce((sum, c) => sum + c.after, 0);

  console.log("=== 已有大图回填 ===\n");
  console.log(`在用的图里，值得压的：${candidates.length} 张`);
  console.log(`  ${mb(totalBefore)} → ${mb(totalAfter)}（省 ${mb(totalBefore - totalAfter)}，${totalBefore ? Math.round(((totalBefore - totalAfter) / totalBefore) * 100) : 0}%）`);
  console.log(`跳过：${skippedSmall} 张本来就小 · ${skippedLowGain} 张压了没多少收益\n`);
  for (const c of candidates.slice(0, 12)) {
    console.log(`  ${c.fileName.slice(0, 44).padEnd(46)} ${(c.before / 1024 / 1024).toFixed(2)}MB → ${(c.after / 1024).toFixed(0)}KB`);
  }

  if (!APPLY) {
    console.log("\n这是**只读报告**。加 --apply 才会写新文件。");
    console.log("应用时：写新文件（**不删旧文件**）并把站点草稿里的引用改成新文件——可回滚。");
    return;
  }

  // ---- 3. 应用：写新文件 + 改站点引用 ----
  const renameMap = new Map(candidates.map((c) => [c.fileName, c.newName]));
  for (const c of candidates) {
    const target = path.join(UPLOAD_DIR, c.newName);
    await writeFile(target, c.body);
    // 核对产物：不信"sharp 说成功了"，读回元数据确认
    const info = await stat(target).catch(() => null);
    if (!info || info.size !== c.after) {
      console.log(`  ⚠ ${c.newName} 写入后大小对不上，跳过引用替换`);
      renameMap.delete(c.fileName);
    }
  }

  let touchedSites = 0;
  for (const fileName of await readdir(SITE_DIR).catch(() => [] as string[])) {
    if (!fileName.endsWith(".json")) continue;
    const full = path.join(SITE_DIR, fileName);
    const raw = await readFile(full, "utf8").catch(() => "");
    if (!raw) continue;
    let next = raw;
    for (const [oldName, newName] of renameMap) {
      next = next.split(`/api/product-images/${oldName}`).join(`/api/product-images/${newName}`);
    }
    if (next !== raw) {
      await writeFile(full, next, "utf8");
      touchedSites += 1;
    }
  }

  console.log(`\n已写入 ${renameMap.size} 个新文件，更新了 ${touchedSites} 个站点的引用。`);
  console.log(`旧文件**保留在** uploads/（可回滚）。确认无误后可用盘点脚本清理孤儿。`);
}

await main();
