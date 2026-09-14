"use client";

/**
 * 生成过程视图（"AI 正在填充内容"）——B5 拆文件 · generate 第五块（最后一块）。
 *
 * ## 边界
 *
 * 父级那层 `{step === "generating" && (...)}` 不进组件：**条件渲染留在父级**。
 *
 * ## 依赖面（28 个符号，但**零 setter、零 ref**）
 *
 * 读：`completion`（9 字段富对象）/ `phase` / `elapsedSeconds` /
 *     `progressText` / `progress` / `progressLabel` /
 *     `waitNotice` / `sections` / `sectionState` /
 *     `completedSections` / `activeSections` / `recoveringSections` / `failedSections` /
 *     `busy` / `intent.companyName` / `sectionsLabels`
 * 出口（2 个，全部透传）：
 *   `onRecoverMissing`（补全缺失板块）/ `onEnterWorkspace`（进工作台）
 *
 * **没有任何 setState**——这是 5 块里最"纯"的一块（比 confirm 干净得多）。
 * B4 时期它被判为"不可搬（触红线）"，是因为当时**同时**想搬 `analyze`/`execute`
 * 那两段状态机；单看这块本身，它只是读 + 两个回调。
 *
 * ## 纯搬家声明
 *
 * JSX 逐字来自拆分前的 generate 页 generating 块内部，仅做"闭包引用 → props"的机械替换。
 */

import { ArrowRight, Check, CircleAlert, LoaderCircle, Sparkles } from "lucide-react";

export type GenerationCompletionView = {
  siteId: string;
  partial: boolean;
  fallbackReason: string;
  missingSections: string[];
  rejected: string[];
  notice: string;
  requiresReview: boolean;
  quality?: { publishable?: boolean } | null;
};

type Props = {
  /** null = 仍在生成；非 null = 初稿已保存、等待确认 */
  completion: GenerationCompletionView | null;
  phase: "content" | "review" | "saving";
  elapsedSeconds: number;
  waitNotice: string | null;
  progress: number;
  progressLabel: string;
  progressText: string;
  companyName: string;
  /** 匹配到的模板名（展示为「匹配模板 · <名字>」） */
  templateName: string;
  sections: string[];
  /** 单节状态：done / failed / recovering / active / waiting */
  sectionState: (section: string) => string;
  activeSections: string[];
  completedSections: string[];
  failedSections: string[];
  recoveringSections: string[];
  labels: Record<string, string>;
  busy: boolean;
  onRecoverMissing: () => void;
  onEnterWorkspace: (siteId: string, partial: boolean) => void;
};

export function GenerationProgressView({
  completion, phase, elapsedSeconds, waitNotice, progress, progressLabel, progressText,
  companyName, templateName, sections, sectionState, activeSections, completedSections, failedSections,
  recoveringSections, labels, busy, onRecoverMissing, onEnterWorkspace,
}: Props) {
  return (
            <div className="generate-progress-view">
              <div className="eyebrow">{completion ? "站点初稿已保存 · 等待你确认" : "复用模板结构 · AI 正在填充内容"}</div>
              <h1>{completion ? "当前结果已保存" : companyName || "你的网站"}</h1>
              <div className={`generate-building-preview ${phase === "content" ? "" : phase}`} aria-hidden="true">
                <div className="generate-building-bar"><i /><i /><i /><span /></div>
                <div className={`generate-building-hero ${sectionState("hero")}`}><span /><strong /><small /></div>
                <div className="generate-building-grid">
                  {sections.filter((section) => section !== "hero").map((section) => (
                    <span key={section} className={sectionState(section)} />
                  ))}
                </div>
                {(phase === "review" || phase === "saving") && <div className="generate-saving-shimmer" />}
              </div>
              <div className="generate-steps" aria-live="polite">
                <div className="generate-elapsed"><span>已用时间</span><strong>{elapsedSeconds} 秒</strong></div>
                {waitNotice && <div className="step active" role="status"><LoaderCircle size={13} className="spin" />{waitNotice}</div>}
                <div className="generate-completion-progress-meta" aria-live="polite">
                  <span>建站进度</span>
                  <strong>{progressLabel}</strong>
                </div>
                <div
                  className="generate-completion-progress"
                  role="progressbar"
                  aria-label="建站进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  aria-valuetext={progressLabel}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="step done"><Check size={13} /> 理解需求</div>
                <div className="step done"><Check size={13} /> 匹配模板 · {templateName}</div>
                <div className="generate-section-progress">
                  {sections.map((section) => {
                    const done = completedSections.includes(section);
                    const failed = failedSections.includes(section);
                    const recovering = recoveringSections.includes(section);
                    const active = activeSections.includes(section) && phase === "content";
                    const state = done ? "done" : failed ? "failed" : recovering ? "recovering" : active ? "active" : "waiting";
                    return <div className={`step ${state}`} key={section}>{done ? <Check size={13} /> : failed ? <CircleAlert size={13} /> : active || recovering ? <LoaderCircle size={13} className="spin" /> : <span className="generate-step-dot" />}{labels[section] ?? section}{recovering && <small>恢复中</small>}{failed && <small>稍后补全</small>}</div>;
                  })}
                </div>
                <div className={`step ${completion ? "done" : phase === "review" || phase === "saving" ? "active" : ""}`}>{completion ? <Check size={13} /> : phase === "review" || phase === "saving" ? <LoaderCircle size={13} className="spin" /> : <span className="generate-step-dot" />}{progressText}</div>
              </div>
              {completion?.requiresReview && (
                <section className="generate-terminal-panel" role="status">
                  <strong>{completion.rejected.length > 0 ? `初稿已保存，${completion.rejected.length} 项内容未写入模板` : completion.missingSections.length > 0 ? "初稿已保存，部分板块待补全" : completion.fallbackReason ? "已切换兼容模板并保存初稿" : completion.quality && !completion.quality.publishable ? "初稿已保存，建议处理内容质量问题" : "缺失板块已补全"}</strong>
                  <p>{completion.notice}</p>
                  {/*
                    被拒操作显性化（2026-09-11）：这些内容**没有写进模板**，
                    此前与"成功"混在一起完全静默。列出人话原因 + 操作指引。
                  */}
                  {completion.rejected.length > 0 && (
                    <div aria-label="未写入模板的内容" style={{ display: "grid", gap: 6 }}>
                      {completion.rejected.slice(0, 6).map((reason, index) => (
                        <div className="step failed" key={`${index}-${reason}`}>
                          <CircleAlert size={13} />
                          {reason}
                        </div>
                      ))}
                      {completion.rejected.length > 6 && (
                        <div className="step failed"><CircleAlert size={13} />另有 {completion.rejected.length - 6} 项，可在工作台让 AI 精简后重写</div>
                      )}
                    </div>
                  )}
                  {/*
                    2026-09-10 净删减：此处原有一段「缺口 N，伪造内容 N，说明性语句 N，超长 N，
                    待补充 N，语言问题 N，待确认事实 N」的**七项计数**。
                    用户明确答复「不点，我直接进工作台看」——他不看这个面板，
                    七项干巴巴的数字对他没有可操作性。真正有用的做法是
                    **进工作台后能定位到具体槽位**（见 app/workspace/page.tsx 的发布拦截提示）。
                  */}
                  {completion.missingSections.length > 0 && (
                    <div className="generate-section-progress" aria-label="待补全板块">
                      {completion.missingSections.map((section) => (
                        <div className={`step ${recoveringSections.includes(section) ? "recovering" : "failed"}`} key={section}>
                          {recoveringSections.includes(section) ? <LoaderCircle size={13} className="spin" /> : <CircleAlert size={13} />}
                          {labels[section] ?? section}
                          <small>{recoveringSections.includes(section) ? "补全中" : "待补全"}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {completion.missingSections.length > 0 && (
                    <button type="button" className="primary-button" disabled={busy} onClick={() => void onRecoverMissing()}>
                      {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                      {busy ? "正在补全缺失板块" : "仅补全缺失板块"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onEnterWorkspace(completion.siteId, completion.partial)}
                  >
                    <ArrowRight size={15} />
                    {completion.missingSections.length > 0 ? "进入工作台继续补全" : "进入工作台查看"}
                  </button>
                </section>
              )}
            </div>
  );
}
