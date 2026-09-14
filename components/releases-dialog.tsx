"use client";

/**
 * 版本历史 / 回滚弹窗（B4 拆文件 · 第四刀，最后一个低风险弹窗）。
 *
 * ## 边界
 *
 * 从 `app/workspace/page.tsx` 搬出的自包含模态：列出发布快照，可回滚。
 * **数据获取与回滚请求仍在父级**（`openReleases` / `rollbackTo` 一字未动）
 * ——本组件是**受控列表**：数据、忙碌、错误三态由 props 进，动作事件出。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * JSX 逐字来自拆分前的 workspace 页（`{releasesOpen && (...)}`）。三处细节
 * 原样保留，**任何一个都不许"顺手改"**：
 *  - `new Date(...).toLocaleString("zh-CN")` 的时区/格式依赖运行时区域；
 *  - `release.rollbackOf.slice(0, 8)` 的 8 位短 id 截断；
 *  - 状态分支 `status === "published"` → "当前线上"，**否则**才渲染回滚按钮
 *    （"当前线上"那条不给回滚按钮——回滚到自己没有意义）。
 */
import { AlertCircle, X } from "lucide-react";

export type ReleaseRow = {
  releaseId: string;
  version: number;
  status: "published" | "superseded";
  createdAt: string;
  publishedBy: string;
  rollbackOf?: string;
};

type Props = {
  releases: ReleaseRow[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRollback: (releaseId: string, version: number) => void;
};

export function ReleasesDialog({ releases, busy, error, onClose, onRollback }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="import-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">Releases / History</div><h3>版本历史</h3></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button></div>
      <p className="modal-copy">每次发布都会生成一个独立快照。回滚会以历史内容**新建一个更高版本**（不会删除任何历史），公开页随即读取新版本。</p>
      {busy && <p className="modal-copy">正在读取版本历史…</p>}
      {error && <div className="import-result error"><AlertCircle size={14} /><div><strong>操作失败</strong><span>{error}</span></div></div>}
      {!busy && !error && releases.length === 0 && <p className="modal-copy">还没有发布过任何版本。点击「发布」即可生成第一个快照。</p>}
      {releases.length > 0 && (
        <div className="release-list">
          {releases.map((release) => (
            <div className="release-row" key={release.releaseId}>
              <div className="release-meta">
                <strong>v{release.version}</strong>
                <span>{new Date(release.createdAt).toLocaleString("zh-CN")}</span>
                {release.rollbackOf ? <span className="release-tag">回滚自 {release.rollbackOf.slice(0, 8)}</span> : null}
              </div>
              {release.status === "published"
                ? <span className="release-current">当前线上</span>
                : <button type="button" className="secondary-button" disabled={busy} onClick={() => onRollback(release.releaseId, release.version)}>回滚到此版本</button>}
            </div>
          ))}
        </div>
      )}
      <div className="modal-foot"><span>共 {releases.length} 个版本</span><button className="primary-button" onClick={onClose}>完成</button></div>
    </div></div>
  );
}
