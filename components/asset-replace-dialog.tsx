"use client";

/**
 * 资产替换弹窗（B4 拆文件 · 第二刀）。
 *
 * ## 边界
 *
 * 从 `app/workspace/page.tsx` 搬出的自包含模态：上传实拍图替换首屏主视觉 /
 * 品牌 Logo，或恢复模板原图。**编排仍在父级**（`replaceAsset` 里的
 * `saveOperations` / `setEditHint` / 关闭时序一字未动）——本组件只发事件。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * JSX 逐字来自拆分前的 workspace 页（`{assetDialog && (...)}` 那一块），
 * 只把闭包引用改成 props：
 *  - `assetDialog.target` → `target`；`assetDialog.currentSrc` → `currentSrc`；
 *  - `assetBusy` → `busy`；`draft.assets[…]` → `hasAsset`；
 *  - `assetFileRef` / `replaceAsset` / `setAssetDialog(null)` → 组件内 ref 与三个回调。
 *
 * ⚠️ **遮罩点击的守卫条件保持原样**：`onClick={() => !busy && onClose()}`
 * ——上传中点遮罩不关闭；而关闭按钮 `disabled={busy}` 是另一条独立守卫。
 * ⚠️ **不接管 `assetDialog` 开关**：父级仍做 `{assetDialog && <AssetReplaceDialog/>}`。
 */
import { CloudUpload, LoaderCircle, X } from "lucide-react";
import { useRef } from "react";

export type AssetTarget = "hero.image" | "brand.logo";

type Props = {
  target: AssetTarget;
  /** 当前资产的 URL（无则不渲染"当前图片"预览区） */
  currentSrc: string;
  /** 草稿里这个 target 是否已有替换过的资产（决定底栏文案与"恢复"是否可用） */
  hasAsset: boolean;
  /** 上传中：遮罩守卫、按钮 disabled、上传区文案都看它 */
  busy: boolean;
  onClose: () => void;
  /** 用户选了图片文件 */
  onPickFile: (file: File) => void;
  /** 恢复模板原图 */
  onReset: () => void;
};

export function AssetReplaceDialog({
  target,
  currentSrc,
  hasAsset,
  busy,
  onClose,
  onPickFile,
  onReset,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const label = target === "hero.image" ? "首屏主视觉" : "品牌 Logo";

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><div className="eyebrow">Asset / Image</div><h3>替换{label}</h3></div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={15} /></button>
        </div>
        <p className="modal-copy">上传企业实拍图（JPG / PNG / WebP / SVG，≤5MB）。替换后会在预览中即时生效，并随导出一起内联。</p>
        {/* T-25：用户实测把「替换首屏主视觉」当成了传产品图。产品图有自己的入口
            （商品表格导入的「图片/图片URL」列），这里写清楚免得再次跑错门。 */}
        {target === "hero.image" && (
          <p className="modal-note">这里换的是首屏大图；产品图请通过「上传商品表格」上传。</p>
        )}
        {currentSrc && (
          <div className="asset-preview"><span>当前图片</span><img src={currentSrc} alt="当前资产" /></div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif,image/avif"
          hidden
          onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; if (file) onPickFile(file); }}
        />
        <div className="upload-zone" onClick={() => !busy && fileRef.current?.click()}>
          <div className="upload-icon">{busy ? <LoaderCircle size={20} className="spin" /> : <CloudUpload size={20} />}</div>
          <strong>{busy ? "正在上传…" : "点击上传实拍图"}</strong>
          <span>建议横图 16:9 或 4:3，宽度 ≥1600px</span>
          <small>JPG / PNG / WebP / SVG · 最大 5MB</small>
        </div>
        <div className="modal-foot">
          <span>当前{hasAsset ? "已替换" : "使用模板原图"}</span>
          <button className="secondary-button" disabled={busy || !hasAsset} onClick={onReset}>恢复模板原图</button>
          <button className="primary-button" disabled={busy} onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
