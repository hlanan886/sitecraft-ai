"use client";

/**
 * 站点素材弹窗（B4 拆文件 · 第三刀）。
 *
 * ## 边界
 *
 * 从 `app/workspace/page.tsx` 搬出的自包含模态：粘贴企业原文，作为 AI 写文案的
 * 事实依据。**保存编排仍在父级**（`saveMaterial` 的 PATCH、`setEditHint` 时序一字未动）
 * ——本组件是**受控**的：值、忙碌、已保存三态都由 props 进、事件出。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * JSX 逐字来自拆分前的 workspace 页（`{materialOpen && (...)}`），只把闭包引用
 * 改成 props；`maxLength={20000}` / `rows={12}` / placeholder 全文一字未改。
 *
 * ⚠️ **一个字都没有"顺手改"的地方**：`onChange` 里 `setMaterialDraft` 之后紧跟的
 * `setMaterialSaved(false)`（"改动即视为未保存"）是既有语义，搬到 props 回调后
 * 仍在父级同一处执行。
 */
import { X } from "lucide-react";

type Props = {
  /** 文本框内容（受控） */
  value: string;
  /** 保存中：按钮 disabled 与文案都看它 */
  busy: boolean;
  /** 已保存标记：底栏计数后缀 */
  saved: boolean;
  onClose: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
};

export function SiteMaterialDialog({ value, busy, saved, onClose, onChange, onSave }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">Source / Material</div><h3>站点素材</h3></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></div>
      <p className="modal-copy">这里的内容会作为 AI 写文案的事实依据（公司简介、产品、资质、案例）。素材里没有的信息不会被编造。改完保存，下次生成/补全时生效。</p>
      <textarea
        className="generate-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例如：华辰光伏成立于 2001 年，专注光伏组件与逆变器制造，通过 ISO 9001 认证，年产能 2GW，产品销往德国、日本……"
        rows={12}
        maxLength={20000}
      />
      <div className="modal-foot">
        <span>{value.trim().length} / 20000{saved ? " · 已保存" : ""}</span>
        <button className="primary-button" disabled={busy} onClick={onSave}>{busy ? "保存中…" : "保存素材"}</button>
      </div>
    </div></div>
  );
}
