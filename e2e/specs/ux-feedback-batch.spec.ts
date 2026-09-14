import { test, expect } from "../helpers/fixtures";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";

import { createSite } from "../helpers/api";
import { sampleProductCsv } from "../../lib/site-model.ts";

/**
 * T-24 / T-25 / T-26 的**浏览器验证**（2026-09-14，会话 B）。
 *
 * ## 为什么必须有这个文件
 *
 * 这三项在 `5b65267` 只做了**单元级**验证（tsc + node:test）。
 * 单元级绿 ≠ 用户看得见——本文件补上"浏览器里真的出现了"这一层。
 *
 * ## 夹具与实现同源（军规 1）
 *
 * T-26 的 CSV 夹具**由 `sampleProductCsv` 现写**，不手抄一份表头——
 * 手抄的那份会在实现改了别名之后**静默变成坏样本**，测的还是旧格式。
 * 这样本文件同时验证了"下载的样例就是解析器能吃的那一份"。
 */

/** 夹具落系统临时目录（`test-results/` 可能不存在）。每次写入，与实现同源。 */
const TEMP_CSV = path.join(os.tmpdir(), "sitecraft-t26-sample.csv");

/** 写入与「下载样例表格」**逐字相同**的内容（含 BOM），供回环导入。 */
async function writeSampleCsv() {
  await writeFile(TEMP_CSV, "﻿" + sampleProductCsv, "utf8");
  return TEMP_CSV;
}

/** 1×1 透明 PNG：给「有图分支」当上传夹具，不落盘、不依赖外部素材。 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * ⚠️ **入口名（附则 A4 教训）**：真实的商品导入入口是**聊天面板底部**的
 * 「上传商品表格」按钮（`components/chat-panel.tsx:209` → `onOpenImport()`），
 * **不是** `app/workspace/page.tsx:1261` 的「导入商品」——那个在**产品隐藏提示条**里，
 * 非常驻。
 *
 * 首次写本文件时我 grep 到「导入商品」就直接拿来写断言，没确认它在页面上**可达**，
 * 于是 T-26/T-27 双双**假红**（挂在本行找不到按钮）。
 * 这与 `asset-select.spec.ts` 里"原断言挑 forge heroimg 但结构不可达"是同一类错：
 * **命令能选中 ≠ 用户在页面上点得到**。
 */
/**
 * 打开商品导入弹窗。
 *
 * ⚠️ 用 `.upload-zone` 的父级 `.import-modal` 定位，**不按无障碍名**——
 * 「上传商品表格」这个名字在 `app/page.tsx:198` 也有一个（是 `<Link>`，
 * 当前页不冲突，但撞名只是时间问题）。
 *
 * 更关键的是**显式断言弹窗可见**：若选择器解析不到，`setInputFiles` 不会报错，
 * 后续断言可能照样绿——那是**假绿**，比假红危险。
 */
async function openImportDialog(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "上传商品表格" }).click();
  await expect(page.locator(".upload-zone"), "商品导入弹窗必须真的打开").toBeVisible({ timeout: 10_000 });
}

test.describe("体验反馈批 · 浏览器验收", () => {
  test("T-24：保存站点素材后的提示写出去向（不是「已保存」就完）", async ({ page, demoSite }) => {
    await page.goto(`/workspace?siteId=${demoSite.id}`);

    // 「素材」入口 → 写入内容 → 保存
    await page.getByRole("button", { name: "素材" }).click();
    const dialog = page.getByRole("heading", { name: "站点素材" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.locator(".import-modal textarea").fill("华辰光伏成立于 2001 年，专注光伏组件与逆变器制造。");
    await page.getByRole("button", { name: "保存素材" }).click();

    // 提示必须包含**去向**——这正是 T-24 的诉求（用户此前以为"没生效"）
    await expect(page.locator(".edit-hint")).toContainText("重生成", { timeout: 15_000 });
  });

  test("T-25：资产替换弹窗说明「换的是首屏大图、产品图走商品表格」", async ({ page, request }) => {
    // 用 moon：forge 的主视觉在点选链路**不可达**（T-15），点不出弹窗
    const site = await createSite(request, "moon");
    await page.goto(`/workspace?siteId=${site.id}`);
    await page.getByRole("button", { name: "直接编辑" }).click();
    await page.waitForTimeout(800);

    const frame = page.frameLocator("iframe");
    const img = frame.locator('img[src*="astronaut"]').first();
    await img.waitFor({ timeout: 20_000 });
    const box = await img.boundingBox();
    expect(box, "主视觉必须有可见包围盒").toBeTruthy();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const heading = page.getByRole("heading", { name: "替换首屏主视觉" });
    await expect(heading, "点主视觉应打开资产替换弹窗").toBeVisible({ timeout: 10_000 });
    // T-25 的澄清行：必须点名「产品图」和它的真实入口
    await expect(page.locator(".modal-note")).toContainText("产品图");
    await expect(page.locator(".modal-note")).toContainText("商品表格");
  });

  test("T-26：商品导入弹窗有「下载样例表格」，且样例能被真正导入", async ({ page, demoSite }) => {
    const csvPath = await writeSampleCsv();

    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await openImportDialog(page);

    // ① 链接在场
    const download = page.getByRole("button", { name: "下载样例表格" });
    await expect(download, "弹窗里必须有下载样例的入口").toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".import-sample")).toContainText("照它的表头填");

    // ② 真的能下载，且下到的字节以 BOM 开头（Excel 中文不乱码的前提）
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toBe("商品表格样例.csv");
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes[0], "应带 UTF-8 BOM（否则 Excel 按 GBK 读会把中文列头显示成乱码）").toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    // ③ 用**同一份内容**回环导入——证明样例是解析器能吃的，不是摆设
    await page.locator(".upload-zone input[type='file']").setInputFiles(csvPath);
    await expect(page.locator(".import-result")).toContainText("已保存", { timeout: 15_000 });
    await expect(page.locator(".import-result")).toContainText("新增或更新 1 个商品");
  });

  test("T-27：缩略图容器不再 repeat（有图与无图两条分支都要成立）", async ({ page, demoSite }) => {
    const csvPath = await writeSampleCsv();
    await page.goto(`/workspace?siteId=${demoSite.id}`);
    await openImportDialog(page);
    await page.locator(".upload-zone input[type='file']").setInputFiles(csvPath);
    await expect(page.locator(".import-result")).toContainText("已保存", { timeout: 15_000 });

    const thumb = page.locator(".product-image-thumb").first();
    await expect(thumb).toBeVisible();

    /**
     * ⚠️ **必须两条分支都测**——本文件首版只测了一条，红了。
     *
     * 概览样例 CSV 的**图片列是空的** → 导入出的商品无图 → 走**无图分支**。
     * 无图分支若用 `background:` **简写**赋色，会重置 `background-repeat`
     * （内联样式优先于样式表）→ 样式表写对了也被吃掉（实测 computed = `repeat`）。
     * 有图分支用的是 `backgroundImage` 长属性，不重置。
     *
     * 所以两条分支的读数**可能不同**，只测一条就会把结论推广错。
     */
    const noImage = await thumb.evaluate((el) => getComputedStyle(el).backgroundRepeat);
    expect(noImage, "T-27（无图分支）：必须 no-repeat——简写 background 会重置它").toContain("no-repeat");

    // 给同一商品传一张主图（走**有图分支**）——多商品时用行作用域定位，避免点错行
    await page.locator(".product-image-row").first().getByText("上传", { exact: true }).click();
    await page.locator(".product-image-row").first().locator('input[type="file"]')
      .setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect
      .poll(async () => await page.locator(".product-image-row").first().locator(".product-image-thumb").getAttribute("style"), { timeout: 20_000 })
      .toContain("/api/product-images/");

    const withImage = await thumb.evaluate((el) => getComputedStyle(el).backgroundRepeat);
    expect(withImage, "T-27（有图分支）：同样必须 no-repeat").toContain("no-repeat");

    /**
     * **自证分辨力**（附则 A4）：注入坏样本逼回浏览器默认 `repeat`，
     * 同一读取路径必须读出 repeat——否则上面两条测的不是样式。
     */
    await thumb.evaluate((el) => { (el as HTMLElement).style.backgroundRepeat = "repeat"; });
    const injected = await thumb.evaluate((el) => getComputedStyle(el).backgroundRepeat);
    expect(injected, "坏样本：注入 repeat 后必须读出 repeat（否则上面两条无分辨力）").toContain("repeat");
    expect(injected).not.toContain("no-repeat");
  });
});
