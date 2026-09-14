/**
 * 盘点 `.sitecraft-data` 里的**死产物**——只报告，不删除。
 *
 * 用法：
 *   node --experimental-strip-types scripts/inventory-artifacts.mts          # 只报告
 *   node --experimental-strip-types scripts/inventory-artifacts.mts --delete # 真删（需显式指定）
 *
 * ## 为什么要这个
 *
 * 2026-09-11 盘点：uploads 占了 **23.8MB**，其中大部分是测试期间上传、
 * **没有任何站点引用**的孤儿图。而它只会涨——每次实测都留几张。
 * 磁盘不是主要问题，主要问题是**没人知道哪些能删**：删错了模板，
 * 所有引用它的站点都会变成破图。
 *
 * 所以这个脚本的核心不是"删"，是**把"能不能删"算清楚**：
 * 一个产物只有在**没有任何站点引用它**时才可能被删。
 *
 * ## 判定规则（每条都可辩护）
 *
 * | 类型 | 可删条件 |
 * |---|---|
 * | 上传图片 | 没有任何站点的草稿引用它（`product.image` / `assets.*.url`） |
 * | 模板 | 没有任何站点用这个 templateId |
 * | 抓取截图 | 永远是过程产物，随时可删 |
 *
 * **默认不删**——先看报告，确认无误再 `--delete`。
 * 自助产品里，"我们的清理脚本删了客户的图"是最糟的一类事故。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DATA_ROOT = path.resolve(process.cwd(), ".sitecraft-data");
const DELETE = process.argv.includes("--delete");

type Report = {
  uploads: { total: number; orphans: string[]; bytes: number; orphanBytes: number };
  templates: { total: number; orphans: string[] };
  captures: { total: number; bytes: number };
  sites: { total: number; referencedTemplates: Set<string>; referencedImages: Set<string> };
};

async function main() {
  const report: Report = {
    uploads: { total: 0, orphans: [], bytes: 0, orphanBytes: 0 },
    templates: { total: 0, orphans: [] },
    captures: { total: 0, bytes: 0 },
    sites: { total: 0, referencedTemplates: new Set(), referencedImages: new Set() },
  };

  // ---- 1. 扫所有站点，收集"被引用了什么" ----
  const siteDir = path.join(DATA_ROOT, "sites");
  const siteFiles = await readdir(siteDir).catch(() => [] as string[]);
  for (const fileName of siteFiles) {
    if (!fileName.endsWith(".json")) continue;
    report.sites.total += 1;
    const raw = await readFile(path.join(siteDir, fileName), "utf8").catch(() => "");
    if (!raw) continue;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      // 半截文件（写到一半崩了）不算引用——但**要报出来**，它本身是需要处理的问题
      report.sites.referencedTemplates.add(`__corrupt__:${fileName}`);
      continue;
    }
    const draft = (record as { draft?: Record<string, unknown> })?.draft;
    if (!draft) continue;
    if (typeof draft.templateId === "string") report.sites.referencedTemplates.add(draft.templateId);

    // 商品图
    const products = Array.isArray(draft.products) ? draft.products : [];
    for (const product of products as Array<{ image?: unknown }>) {
      if (typeof product?.image === "string" && product.image.startsWith("/api/product-images/")) {
        report.sites.referencedImages.add(path.basename(product.image));
      }
    }
    // 资产槽（首屏主视觉 / 品牌 logo）
    const assets = (draft.assets ?? {}) as Record<string, { url?: unknown } | undefined>;
    for (const asset of Object.values(assets)) {
      const url = asset?.url;
      if (typeof url === "string" && url.startsWith("/api/product-images/")) {
        report.sites.referencedImages.add(path.basename(url));
      }
    }
    // 站内任何字符串里出现过的 uploads 文件名（兜底：路径可能藏在别处）
    for (const match of raw.matchAll(/\/api\/product-images\/([A-Za-z0-9._-]+)/g)) {
      report.sites.referencedImages.add(match[1]);
    }
  }

  // ---- 2. 上传图片 ----
  const uploadDir = path.join(DATA_ROOT, "uploads");
  for (const fileName of await readdir(uploadDir).catch(() => [] as string[])) {
    const info = await stat(path.join(uploadDir, fileName)).catch(() => null);
    if (!info?.isFile()) continue;
    report.uploads.total += 1;
    report.uploads.bytes += info.size;
    if (!report.sites.referencedImages.has(fileName)) {
      report.uploads.orphans.push(fileName);
      report.uploads.orphanBytes += info.size;
    }
  }

  // ---- 3. 模板 ----
  const templateDir = path.join(DATA_ROOT, "generated-templates");
  for (const name of await readdir(templateDir).catch(() => [] as string[])) {
    const info = await stat(path.join(templateDir, name)).catch(() => null);
    if (!info?.isDirectory()) continue;
    report.templates.total += 1;
    if (!report.sites.referencedTemplates.has(name)) report.templates.orphans.push(name);
  }

  // ---- 4. 抓取截图（永远是过程产物） ----
  const captureDir = path.join(DATA_ROOT, "captures");
  for (const fileName of await readdir(captureDir).catch(() => [] as string[])) {
    const info = await stat(path.join(captureDir, fileName)).catch(() => null);
    if (!info?.isFile()) continue;
    report.captures.total += 1;
    report.captures.bytes += info.size;
  }

  // ---- 报告 ----
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + "MB";
  console.log("=== .sitecraft-data 盘点 ===\n");
  console.log(`站点 ${report.sites.total} 个 · 引用模板 ${report.sites.referencedTemplates.size} 个 · 引用图片 ${report.sites.referencedImages.size} 张\n`);
  console.log(`上传图片  ${report.uploads.total} 张 / ${mb(report.uploads.bytes)}`);
  console.log(`  孤儿    ${report.uploads.orphans.length} 张 / ${mb(report.uploads.orphanBytes)}  ← 没有任何站点引用`);
  console.log(`模板      ${report.templates.total} 个`);
  console.log(`  孤儿    ${report.templates.orphans.length} 个  ${report.templates.orphans.slice(0, 8).join(", ") || "（无）"}`);
  console.log(`抓取截图  ${report.captures.total} 张 / ${mb(report.captures.bytes)}  ← 过程产物，随时可删`);

  const corrupt = [...report.sites.referencedTemplates].filter((id) => id.startsWith("__corrupt__"));
  if (corrupt.length > 0) {
    console.log(`\n⚠ ${corrupt.length} 个站点文件损坏（读不出 JSON）：${corrupt.map((c) => c.split(":")[1]).slice(0, 5).join(", ")}`);
  }

  if (!DELETE) {
    console.log("\n这是**只读报告**。确认无误后加 --delete 才会真删。");
    console.log("删除范围：孤儿上传图 + 抓取截图（**不删模板**——模板删了会让引用它的站点变破图）。");
    return;
  }

  // ---- 删除（保守：只删上传孤儿与抓取截图） ----
  let removed = 0;
  let freed = 0;
  for (const fileName of report.uploads.orphans) {
    const target = path.join(uploadDir, fileName);
    const info = await stat(target).catch(() => null);
    if (!info) continue;
    const { unlink } = await import("node:fs/promises");
    await unlink(target).catch(() => {});
    removed += 1;
    freed += info.size;
  }
  for (const fileName of await readdir(captureDir).catch(() => [] as string[])) {
    const target = path.join(captureDir, fileName);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) continue;
    const { unlink } = await import("node:fs/promises");
    await unlink(target).catch(() => {});
    removed += 1;
    freed += info.size;
  }
  console.log(`\n已删除 ${removed} 个文件，释放 ${mb(freed)}。`);
  console.log(`模板目录**未动**（${report.templates.total} 个，其中 ${report.templates.orphans.length} 个当前无站点引用——要删请连同站点一起确认）。`);
}

await main();
