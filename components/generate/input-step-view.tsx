"use client";

/**
 * 输入页（"用一句话开始"）——B5 拆文件 · generate 第三块。
 *
 * ## 边界
 *
 * 父级那层 `{step === "input" && (...)}` 不进组件：**条件渲染留在父级**。
 *
 * ## 依赖面（13 个符号）
 *
 * 读：`message` / `extraContext` / `error` / `busy` / `progressText` /
 *     `draftRestored` / `adjusting`
 * 出口（全部由父级负责，组件只发事件）：
 *   `onChangeMessage` / `onChangeExtraContext`（都带 `setDraftRestored(false)`）
 *   `onBackToConfirm` / `onSubmit` / `onRestart`
 *
 * ## 两条业务规则**原样搬来，不许顺手改**
 *
 * 1. **空/纯符号拦截**：正向检测 `/[\p{L}\p{N}]/u`（!!!/组合 emoji/带肤色 emoji 全拦，
 *    全角文字正确放行）；
 * 2. **重新开始 = 全量清空迭代状态**（history/intent/template/hiddenSections/
 *    adjusting/message/error/clarifyState/clarifyText 九项），父级负责。
 *
 * ## 纯搬家声明
 *
 * JSX 逐字来自拆分前的 generate 页，仅做"闭包引用 → props"的机械替换。
 */

import { AlertCircle, ArrowRight, LoaderCircle, WandSparkles } from "lucide-react";

/** 示例需求。此前是页面级常量，实测**只有本块用**（声明 1 处 / 使用 1 处），故随块搬来。 */
const examples = [
  "做个光伏出口企业的官网，主打欧美，要显得专业可靠",
  "帮我的 SaaS 团队做官网，用户是海外开发者",
  "工业零部件厂的官网，突出质量和服务",
  "设计咨询公司的作品集网站",
];

type Props = {
  message: string;
  extraContext: string;
  error: string | null;
  busy: boolean;
  progressText: string;
  draftRestored: boolean;
  /** 调整模式：在已确认需求上继续说（按钮文案与"返回确认页"按钮随之变化） */
  adjusting: boolean;
  onChangeMessage: (value: string) => void;
  onChangeExtraContext: (value: string) => void;
  onBackToConfirm: () => void;
  /** 父级负责空/纯符号校验与错误提示（规则见文件头） */
  onSubmit: () => void;
  /** 父级负责九项状态清空 */
  onRestart: () => void;
};

export function InputStepView({
  message,
  extraContext,
  error,
  busy,
  progressText,
  draftRestored,
  adjusting,
  onChangeMessage,
  onChangeExtraContext,
  onBackToConfirm,
  onSubmit,
  onRestart,
}: Props) {
  return (
            <div className="generate-input">
              <div className="eyebrow">{adjusting ? "继续调整需求" : "✨ 自然语言建站"}</div>
              <h1>
                {adjusting ? (
                  <>还想怎么改？<br /><span style={{ color: "#2e6b4f" }}>继续聊，我接着调。</span></>
                ) : (
                  <>用一段对话，<br /><span style={{ color: "#2e6b4f" }}>变成一座网站。</span></>
                )}
              </h1>
              <p>{adjusting ? "在已确认的需求上继续说，AI 只改你提到的地方。" : "描述你的业务，AI 帮你选模板、出初稿，再进工作台精修。"}</p>
              <textarea
                className="generate-textarea"
                value={message}
                onChange={(e) => onChangeMessage(e.target.value)}
                placeholder={adjusting ? "例如：改成日系风格 / 加上预约功能" : "例如：做个光伏出口企业的官网，主打欧美，要显得专业可靠"}
                rows={3}
                maxLength={400}
              />
              <div className="generate-char-count">{message.trim().length}/400</div>
              {!adjusting && (
                <div className="generate-examples">
                  {examples.map((ex) => (
                    <button key={ex} className="generate-chip" onClick={() => onChangeMessage(ex)}>
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              {!adjusting && (
                <details className="generate-import">
                  <summary>有现成的公司简介或产品清单？粘贴进来（选填，让内容更准）</summary>
                  <textarea
                    className="generate-textarea"
                    value={extraContext}
                    onChange={(e) => onChangeExtraContext(e.target.value)}
                    placeholder="粘贴公司简介 / 产品清单 / 资质与案例，例如：华辰光伏成立于 2001 年，专注光伏组件与逆变器制造，通过 ISO 9001 认证，产品销往欧美……"
                    rows={6}
                    maxLength={20000}
                  />
                  <div className="generate-char-count">{extraContext.trim().length}/20000</div>
                </details>
              )}
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              {draftRestored && <p className="generate-progress" role="status">已恢复刷新前的需求草稿</p>}
              <div className="generate-clarify-actions">
                {adjusting && (
                  <button className="secondary-button" disabled={busy} onClick={() => onBackToConfirm()}>
                    返回确认页
                  </button>
                )}
                <button
                  className="primary-button"
                  disabled={!message.trim() || busy}
                  onClick={() => onSubmit()}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}
                  {busy ? progressText : adjusting ? "更新理解" : "开始理解需求"} <ArrowRight size={15} />
                </button>
                {adjusting && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => onRestart()}
                  >
                    重新开始
                  </button>
                )}
              </div>
              {busy && <p className="generate-progress">{progressText}</p>}
            </div>
  );
}
