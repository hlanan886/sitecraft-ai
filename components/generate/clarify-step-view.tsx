"use client";

/**
 * 追问页（"还差几个关键信息"）——B5 拆文件 · generate 第二块。
 *
 * ## 边界
 *
 * 父级那层 `{step === "clarify" && clarifyState && (...)}` 不进组件：
 * **条件渲染留在父级**（含 `clarifyState` 非空这半条），DOM 嵌套与挂载时机零变化。
 * 组件内只在 `clarifyState` 已保证非空的前提下读它的 `needsInfo`。
 *
 * ## 依赖面（11 个符号）
 *
 * 5 读（`clarifyState` / `clarifyText` / `error` / `busy` / `progressText` / `history`）
 * + 1 写（`setClarifyText`）+ 1 清空（`setClarifyState`）+ 1 回调（`analyze`）。
 *
 * ⚠️ `setClarifyState(null)` 与 `analyze(...)` 是本组件**改动父级状态**的两个出口，
 * 不是纯展示——它们原样搬过来，语义未改（见下）。
 *
 * ## 纯搬家声明
 *
 * JSX 逐字来自拆分前的 generate 页 938-985 行，仅做"闭包引用 → props"的机械替换。
 * 两处业务规则**原样保留，不许顺手改**：
 *  - 追问满 3 轮强制收敛（服务端规则 5 会把"默认值继续"转 ready）；
 *  - 留空或纯符号也走默认值收敛，**不发空串**（避免 400）。
 */

import { AlertCircle, ArrowRight, LoaderCircle, Sparkles } from "lucide-react";

type Props = {
  /** 父级已保证非空 */
  needsInfo: string[];
  clarifyText: string;
  error: string | null;
  busy: boolean;
  progressText: string;
  /** 已追问轮数由父级按 user 消息数**派生**后传入，组件不自己数 */
  rounds: number;
  onChangeClarifyText: (value: string) => void;
  /** 回上一步（输入页）：父级负责 setClarifyState(null) + setStep("input") */
  onBackToInput: () => void;
  /** 收敛：父级负责清空 clarifyState 并发起 analyze */
  onContinue: (text: string) => void;
};

export function ClarifyStepView({
  needsInfo,
  clarifyText,
  error,
  busy,
  progressText,
  rounds,
  onChangeClarifyText,
  onBackToInput,
  onContinue,
}: Props) {
  return (
            <div className="generate-input">
              <div className="eyebrow">还差几个关键信息</div>
              <h1>再告诉我一点，<br /><span style={{ color: "#2e6b4f" }}>才能不瞎猜。</span></h1>
              <p>AI 觉得信息还不够，下面这些问题补充后会更准。也可以留空直接"按默认值继续"。</p>
              <ol className="generate-clarify-list">
                {needsInfo.map((q, i) => (
                  <li key={`${i}-${q}`}>{q}</li>
                ))}
              </ol>
              <textarea
                className="generate-textarea"
                value={clarifyText}
                onChange={(e) => onChangeClarifyText(e.target.value)}
                placeholder="补充回答，例如：我是华辰光伏，做组件出口，客户在欧美"
                rows={3}
                maxLength={400}
              />
              <div className="generate-char-count">{clarifyText.trim().length}/400</div>
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              <div className="generate-clarify-actions">
                <button className="secondary-button" disabled={busy} onClick={() => onBackToInput()}>
                  返回修改
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => {
                        if (rounds >= 3) {
                      // 已追问 3 轮仍信息不足：强制收敛，用默认值（服务端规则 5 转 ready）
                      // 注意：不传空 history——顶层 history 自然携带已收集对话，防丢失
                      onContinue("按默认值继续");
                      return;
                    }
                    // 留空或纯符号 → 也走默认值收敛，不发空串（避免 400）
                    onContinue(clarifyText.trim() || "按默认值继续");
                  }}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  {busy ? progressText : "继续理解"} <ArrowRight size={15} />
                </button>
              </div>
              <p className="generate-progress" style={{ marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
                已追问 {rounds} 轮，最多 3 轮后自动用默认值继续
              </p>
              {busy && <p className="generate-progress">{progressText}</p>}
            </div>
  );
}
