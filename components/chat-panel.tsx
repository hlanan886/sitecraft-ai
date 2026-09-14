"use client";

/**
 * AI 对话面板（B4 拆文件 · 合并一刀）。
 *
 * ## 切法说明（用户 2026-09-13 裁决）
 *
 * 原计划的 1a（纯展示）/1b（生命周期）**两刀切法作废**——真实 JSX 里
 * "破坏性确认弹窗"内联在输入区、busy 气泡的取消按钮内联在消息流里，
 * 展示与生命周期是同一棵树的交错，切不出干净边界。改为**整块一刀**。
 *
 * ## ref 归属（红线：不挪 owner）
 *
 * `messagesNearBottomRef` / `userJustSentRef` **留在父级**——它们被这条面板的
 * 滚到底逻辑与父级的消息追加逻辑**共同读写**，搬走就是改状态归属。
 * 本组件通过 props 接收 `nearBottomRef` 并只做读/写，不持有。
 *
 * ## 纯搬家声明（B4 红线：零行为变更）
 *
 * JSX 逐字来自拆分前的 workspace 页 1166-1255 行，仅做闭包引用 → props 的
 * 机械替换。**一个字符的回滚/文案/条件都没改**。
 */
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, Cloud, History, LoaderCircle, MoreHorizontal, Send, Sparkles, X } from "lucide-react";
import { useRef, type RefObject } from "react";

import type { ChangeDiff } from "@/lib/change-diff";

export type ChatMessageView = {
  id: string;
  role: "assistant" | "user";
  text: string;
  change?: string;
  status?: "syncing" | "applied" | "warning" | "error" | "no_change";
  revision?: number;
  meta?: string;
  retryText?: string;
  diff?: ChangeDiff[];
  rejected?: string[];
};

export type ChatHistoryItem = {
  id: string;
  revision: number;
  summary: string;
  source: string;
  appliedTargets: string[];
  createdAt: string;
};

export type PendingDestructive = {
  message: string;
  summary: string;
  destructive: string[];
  selectedTarget: { key: string; label: string } | null;
} | null;

export type ProviderStatusView = { mode: "deepseek" | "unconfigured"; model: string | null };

type Props = {
  /** 面板是否在移动端显示（父级按 mobilePane 切换） */
  className: string;
  draft: { siteName: string; revision: number };
  updatedAt: string | null;
  templateName: string;
  providerStatus: ProviderStatusView;
  history: ChatHistoryItem[];
  showHistory: boolean;
  messages: ChatMessageView[];
  input: string;
  busy: boolean;
  busyText: string;
  draftReady: boolean;
  hasCapabilities: boolean;
  selectedTarget: { key: string; label: string } | null;
  pendingDestructive: PendingDestructive;
  /** 父级持有（跨面板共享）——本组件只读/写，不持有 */
  nearBottomRef: RefObject<boolean>;
  /** 滚到底的锚点：由父级 effect 驱动（跨面板依赖 messages/busy） */
  endRef: RefObject<HTMLDivElement | null>;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
  onChangeInput: (value: string) => void;
  onClearTarget: () => void;
  onConfirmDestructive: (confirmed: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onOpenImport: () => void;
};

export function ChatPanel({
  className,
  draft,
  updatedAt,
  templateName,
  providerStatus,
  history,
  showHistory,
  messages,
  input,
  busy,
  busyText,
  draftReady,
  hasCapabilities,
  selectedTarget,
  pendingDestructive,
  nearBottomRef,
  endRef,
  onToggleHistory,
  onCloseHistory,
  onChangeInput,
  onClearTarget,
  onConfirmDestructive,
  onSubmit,
  onCancel,
  onOpenImport,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <aside className={className}>
        <div className="builder-chat-head">
          <div>
            <Link href="/" className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={12} />返回站点</Link>
            <h2>{draft.siteName}</h2>
            <span className="builder-template-name">{templateName}</span>
            <span className="chat-context"><span className={`provider-dot ${providerStatus.mode === "deepseek" ? "remote" : "offline"}`} />{providerStatus.mode === "deepseek" ? `DEEPSEEK API · ${providerStatus.model}` : "DeepSeek 未配置 · 不会执行本地伪修改"}</span>
          </div>
          <Link className="icon-button" href="/templates" aria-label="更换模板"><MoreHorizontal size={16} /></Link>
        </div>
        <div className="draft-status-panel">
          <div className="draft-status-icon"><Cloud size={15} /></div>
          <div><strong>当前草稿 · v{draft.revision}</strong><span>{updatedAt ? `${new Date(updatedAt).toLocaleString("zh-CN")} 保存到服务器` : "正在载入"}</span></div>
          <button type="button" onClick={() => onToggleHistory()}><History size={13} />历史 {history.length}</button>
        </div>
        {showHistory && (
          <div className="draft-history" aria-label="草稿历史">
            <div className="draft-history-head"><strong>修改历史</strong><button onClick={() => onCloseHistory()} aria-label="关闭历史"><X size={13} /></button></div>
            {history.length ? history.map((item) => <div className="history-row" key={item.id}><span>v{item.revision}</span><div><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.source.toUpperCase()}</small></div></div>) : <div className="history-empty">尚无修改记录</div>}
          </div>
        )}
        <div
          className="chat-messages"
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          onScroll={(event) => {
            const node = event.currentTarget;
            nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 96;
          }}
        >
          {messages.map((message) => (
            <div className={`message ${message.role} ${message.status ?? ""}`} key={message.id}>
              <div className="message-label">{message.role === "assistant" ? <><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</> : "YOU"}</div>
              <div className="message-bubble">{message.text}</div>
              {message.retryText && <button className="hint" type="button" onClick={() => { onChangeInput(message.retryText ?? ""); window.requestAnimationFrame(() => inputRef.current?.focus()); }}>重新填写原始指令</button>}
              {message.change && <div className={`change-summary ${message.status ?? ""}`}>{message.status === "error" || message.status === "warning" ? <AlertCircle size={11} /> : message.status === "syncing" ? <LoaderCircle className="spin" size={11} /> : <Check size={11} />}<span>{message.status === "applied" ? "已应用" : message.status === "syncing" ? "同步中" : message.status === "no_change" ? "未修改" : "注意"}：{message.change}{message.meta ? ` · ${message.meta}` : ""}</span></div>}
              {message.diff && message.diff.length > 0 && (
                <div className="change-diff" aria-label="字段级差异">
                  <div className="change-diff-head"><strong>字段变化</strong><span>共 {message.diff.length} 项</span></div>
                  {message.diff.slice(0, 6).map((item) => (
                    <div className="change-diff-row" key={`${message.id}-${item.target}`}>
                      <div className="change-diff-label">{item.label}</div>
                      <div className="change-diff-values"><del title="修改前">{item.before || "未填写"}</del><span aria-hidden="true">→</span><ins title="修改后">{item.after || "未填写"}</ins></div>
                    </div>
                  ))}
                  {message.diff.length > 6 && <div className="change-diff-more">另有 {message.diff.length - 6} 项字段变化，已保存到草稿历史。</div>}
                </div>
              )}
              {/*
                被拒操作显性化（2026-09-11）：这些改动**一项都没写进草稿**，
                却混在"草稿 vN 已保存"里。此前服务端已下发 rejected，前端未消费。
              */}
              {message.rejected && message.rejected.length > 0 && (
                <div className="change-diff" aria-label="未生效的修改">
                  <div className="change-diff-head"><strong>未生效</strong><span>共 {message.rejected.length} 项</span></div>
                  {message.rejected.slice(0, 6).map((reason, index) => (
                    <div className="change-diff-row" key={`${message.id}-rejected-${index}`}>
                      <div className="change-diff-label"><AlertCircle size={11} /> {reason}</div>
                    </div>
                  ))}
                  {message.rejected.length > 6 && <div className="change-diff-more">另有 {message.rejected.length - 6} 项未生效，可换更短的表述重试。</div>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="message assistant"><div className="message-label"><Sparkles size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />SITECRAFT AI</div><div className="message-bubble busy-message"><LoaderCircle className="spin" size={13} /><span>{busyText}</span><button className="hint busy-cancel" type="button" onClick={onCancel} aria-label="取消 AI 请求">取消</button></div></div>}
          <div ref={endRef} />
        </div>
        <div className="chat-input-wrap">
          {selectedTarget && <div className="chat-target"><span>正在修改：{selectedTarget.label}</span><button aria-label="清除修改目标" onClick={() => onClearTarget()} type="button"><X size={12} /></button></div>}
          {pendingDestructive && (
            <div className="destructive-confirm" role="alertdialog" aria-modal="true" aria-labelledby="destructive-confirm-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); void onConfirmDestructive(false); } }}>
              <div className="destructive-confirm-title" id="destructive-confirm-title"><AlertCircle size={13} />确认执行以下操作</div>
              <ul className="destructive-confirm-list">{pendingDestructive.destructive.map((item) => <li key={item}>{item}</li>)}</ul>
              <div className="destructive-confirm-actions">
                <button className="secondary-button" autoFocus onClick={() => void onConfirmDestructive(false)} disabled={busy}>取消</button>
                <button className="primary-button" onClick={() => void onConfirmDestructive(true)} disabled={busy}>确认执行</button>
              </div>
            </div>
          )}
          <form className="chat-input" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            <textarea ref={inputRef} value={input} onChange={(event) => onChangeInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void onSubmit(); } }} placeholder={draftReady && !hasCapabilities ? "正在识别模板可编辑位置..." : "告诉 AI 你想怎么改..."} rows={2} />
            <button className="send-button" type="submit" disabled={!input.trim() || busy || !draftReady || !hasCapabilities} aria-label="发送"><Send size={14} /></button>
          </form>
          <div className="chat-hints"><button className="hint" onClick={() => onChangeInput("只把第二个服务标题改为智能产线集成，其他内容不变")}>修改服务</button><button className="hint" onClick={() => onChangeInput("重写首屏标题和说明，不要更换模板")}>优化首屏</button><button className="hint" onClick={() => onOpenImport()}>上传商品表格</button></div>
        </div>
    </aside>
  );
}
