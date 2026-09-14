/**
 * 工作台·商品表格导入与主图上传（B4 拆文件 · 第一刀）。
 *
 * ## 边界
 *
 * 从 `app/workspace/page.tsx` 搬出的两件**自包含**的事：
 *  - `parseProductFile`：CSV（Papa）/ XLSX（read-excel-file）→ 行数组；
 *  - `uploadProductImage`：POST `/api/product-images` → 图片 URL。
 *
 * 状态与 UI 编排（`setProductImageBusy` / `setEditHint` / `showImport` 开关）
 * 留在组件里——本层是**纯 I/O**，不碰 React。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * 逻辑逐字来自拆分前的 `workspace/page.tsx`：
 *  - `parseProductFile` = 原 `handleFile` 的两个解析分支（xlsx 取首行当表头；
 *    CSV 走 Papa 的 `complete` 回调）；
 *  - `uploadProductImage` = 原 `applyImageToProduct` 里 `file` 非空的那一段
 *    （FormData 字段名 `file`、错误兜底文案 `"图片上传失败"` 均未改）。
 *
 * 唯一的形式改动是"从闭包读"→"从参数读"。拆分后全套 e2e 与拆分前逐项一致。
 */
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";

export type ImportedRow = Record<string, string>;

/** CSV/XLSX → 行数组。xlsx 分支取首行当表头（与拆分前逐字一致）。 */
export async function parseProductFile(file: File): Promise<{ name: string; rows: ImportedRow[] }> {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const rows = await readXlsxFile(file);
    const [header, ...body] = rows;
    const keys = (header ?? []).map((cell) => String(cell ?? "").trim());
    return {
      name: file.name,
      rows: body.map((row) => Object.fromEntries(keys.map((key, index) => [key, String(row[index] ?? "")]))),
    };
  }
  return new Promise((resolve) => {
    Papa.parse<ImportedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve({ name: file.name, rows: results.data }),
    });
  });
}

/**
 * 上传商品主图，返回可写进 `product.image` 的 URL。
 *
 * ⚠️ 失败时抛的错误文案（`"图片上传失败"` 兜底）是用户可见的——**不要改写**。
 */
export async function uploadProductImage(file: File, endpoint = "/api/product-images"): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const upload = await fetch(endpoint, { method: "POST", body: form });
  const uploaded = (await upload.json()) as { ok?: boolean; url?: string; error?: string };
  if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || "图片上传失败");
  return uploaded.url;
}
