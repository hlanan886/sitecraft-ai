"use client";

/**
 * 商品目录导入弹窗（B4 拆文件 · 第一刀）。
 *
 * ## 边界
 *
 * 从 `app/workspace/page.tsx` 搬出的**一个自包含模态**：上传表格 → 解析 →
 * 逐商品上传主图。业务写入仍走父级的 `onImportProducts` / `onUploadImage`
 * 回调（＝原来的 `commitImportedRows` / `applyImageToProduct`），
 * **本组件不直接发请求、不碰草稿状态**。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * JSX 逐字来自拆分前的 workspace 页（`showImport && (...)` 那一块），
 * 只把闭包引用改成 props：
 *  - `draft.products` → `products`；`importState` → `importState`；
 *  - `fileRef` / `handleFile` → 组件内自己的 ref 与 `onPickFile`；
 *  - 关闭动作 `setShowImport(false)` → `onClose`。
 *
 * ⚠️ **不接管 `showImport` 开关**：父级仍在挂载点做条件渲染（`{showImport && <ProductImportDialog/>}`），
 * 与拆分前逐字一致——这样"什么时候渲染"这件事零改动。
 */
import { ChevronRight, CircleAlert, Check, CloudUpload, Download, FileSpreadsheet, Image as ImageIcon, X } from "lucide-react";
import { useRef } from "react";

import { sampleProductCsv } from "@/lib/site-model";

export type ProductImageRow = {
  sku: string;
  name: { zh: string; en: string };
  image?: string | null;
  imageColor?: string | null;
};

export type ImportOutcome = { name: string; imported: number; errors: string[] };

type Props = {
  products: ProductImageRow[];
  /** 上一次导入的结果（成功/失败摘要），null = 还没导过 */
  importState: ImportOutcome | null;
  /** 正在上传主图的 SKU；null = 空闲 */
  productImageBusy: string | null;
  onClose: () => void;
  /** 用户选了表格文件（父级做解析 + 保存，保持原有错误处理位置不变） */
  onPickFile: (file: File) => void;
  /** 上传/清除某个商品的主图（file=null 表示清除） */
  onUploadImage: (sku: string, file: File | null) => void;
};

export function ProductImportDialog({
  products,
  importState,
  productImageBusy,
  onClose,
  onPickFile,
  onUploadImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const withImage = products.filter((item) => item.image).length;

  /**
   * T-26：内置样例表格下载。
   *
   * ⚠️ 表头**从 `sampleProductCsv` 派生**（见 lib/site-model.ts），本组件不得再写一份列名——
   * 手抄第二份就是军规 1 禁的那类债：解析器改了别名，样例不跟着改，用户照样例填完全部报错。
   * `tests/product-sample-csv.test.ts` 用「改了别名样例必须立刻红」钉住这条同源关系。
   *
   * 前缀 "﻿" 是 UTF-8 BOM：Excel 在国内 Windows 下默认按 GBK 读 CSV，
   * 不加 BOM 会把「产品名称」「分类」等中文列头显示成乱码，用户会以为文件坏了。
   */
  const downloadSample = () => {
    const blob = new Blob(["﻿" + sampleProductCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "商品表格样例.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">Content / Products</div><h3>填充你的商品目录</h3></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></div>
      <p className="modal-copy">上传 CSV 或 XLSX 商品表格，校验后直接保存为可撤销草稿。AI 可以继续修改指定 SKU 的中英文名称、简介和分类。</p>
      <div className="upload-zone" onClick={() => fileRef.current?.click()}><input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPickFile(file); }} /><div className="upload-icon"><CloudUpload size={20} /></div><strong>点击上传表格</strong><span>需要包含 SKU、产品名称、分类等字段</span><small>CSV / XLSX · 最多 1000 行</small></div>
      {/* T-26：此前用户要拿到表格格式得去外部打听，这里直接给一份可下载的样例。 */}
      <div className="import-sample"><button type="button" className="link-button" onClick={downloadSample}><Download size={14} />下载样例表格</button><span>不知道列名怎么填？下载样例，照它的表头填即可</span></div>
      <div className="import-options"><div><FileSpreadsheet size={15} /><span>支持中英文列名自动识别</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div><div><ImageIcon size={15} /><span>可选"图片/图片URL"列填产品主图</span><ChevronRight size={13} style={{ marginLeft: "auto" }} /></div></div>
      {importState && <div className={`import-result ${importState.imported ? "" : "error"}`}>{importState.imported ? <Check size={14} /> : <CircleAlert size={14} />}<div><strong>{importState.name} {importState.imported ? "已保存" : "导入失败"}</strong><span>{importState.imported ? `新增或更新 ${importState.imported} 个商品` : importState.errors[0]}{importState.imported && importState.errors.length ? `，${importState.errors.length} 行需要检查` : ""}</span></div></div>}
      {/* 商品主图：2026-09-10 接线。`/api/product-images` 与 `product.image` 早已就绪，
          但此前**没有任何入口能写它**——工厂站的说服力主要来自实拍图，这条是主路径。 */}
      {products.length > 0 && (
        <div className="product-image-list">
          <div className="product-image-head">为商品上传实拍主图（当前 {withImage} / {products.length} 已有图）</div>
          {/* T-27：用户传完不知道图去哪了。去向写在这里，省得他满工作台找。 */}
          <p className="product-image-hint">主图显示在工作台预览「产品」板块的对应商品卡片上。</p>
          {products.map((product) => (
            <div className="product-image-row" key={product.sku}>
              {/* T-27：无图分支必须用 **长属性 `backgroundColor`**，不能用 `background` 简写——
                  `background` 会重置全部 background-* 长属性（含 `background-repeat`、`background-size`），
                  而**内联样式优先于样式表**，于是 `.product-image-thumb` 的
                  `no-repeat` / `cover` 被静默覆盖（实测 computed 为 `repeat`）。
                  这是本轮 T-27 红样本抓到的真问题：样式表写对了、被内联简写吃掉。 */}
              <span className="product-image-thumb" style={product.image ? { backgroundImage: `url(${product.image})` } : { backgroundColor: product.imageColor || "#e5e7eb" }} />
              <span className="product-image-name">{product.name.zh || product.name.en || product.sku}</span>
              <span className="product-image-sku">{product.sku}</span>
              <label className="secondary-button product-image-upload">
                {/* T-27：input 是**全局**禁用的（productImageBusy !== null），但文案此前只看
                    自己这一行 —— A 行上传时 B 行按钮被禁用却仍写「上传」，用户点了没反应
                    又看不出原因。这里让文案与禁用态一致：别的行在传时显示「等待中」。 */}
                {productImageBusy === product.sku ? "上传中…" : productImageBusy ? "等待中…" : product.image ? "更换" : "上传"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={productImageBusy !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    if (file) onUploadImage(product.sku, file);
                  }}
                />
              </label>
              {product.image && (
                <button type="button" className="icon-button" aria-label={`清除 ${product.sku} 主图`} disabled={productImageBusy !== null} onClick={() => onUploadImage(product.sku, null)}><X size={13} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {/* ⚠️ 位置必须与拆分前逐字一致：`modal-foot` 在 `product-image-list` **外面**、
          无条件渲染（商品为空时也要显示"当前草稿商品：0 / 1000"和完成按钮）。 */}
      <div className="modal-foot"><span>当前草稿商品：{products.length} / 1000</span><button className="primary-button" onClick={onClose}>完成</button></div>
    </div></div>
  );
}