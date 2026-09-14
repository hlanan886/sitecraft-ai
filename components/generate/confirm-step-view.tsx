"use client";

/**
 * 确认页（"复用模板结构"）——B5 拆文件 · generate 第四块（最大一块，14KB）。
 *
 * ## 边界
 *
 * 父级那层 `{step === "confirm" && intent && template && (...)}` 不进组件：
 * **条件渲染留在父级**（含 `intent`/`template` 非空这两条），DOM 嵌套与挂载时机零变化。
 * 组件在"两者已保证非空"的前提下工作，故 props 里它们是**非空类型**。
 *
 * ## 依赖面（宽：~50 个符号）
 *
 * 读：`intent` / `template` / `templateOptions` / `recommendationTemplates` /
 *     `recommendationIndex` / `previewCollapsed` / `previewDraft` / `hiddenSections` /
 *     `adjusting` / `busy` / `progressText` / `siteLanguage` /
 *     `regenerateSiteId` / `generationCompletion` / `templates` / `category` /
 *     `error` / `previewFeedback` / `designTokenResult` / `carouselRef` / 四张 LABEL 表
 * 出口（组件只发事件，父级负责改状态）：
 *   `onToggleSection` / `onChangeLanguage` / `onTogglePreviewCollapsed` / `onPreviewStateChange`
 *   / `onMoveRecommendation` / `onScrollRecommendation`(imper) / `onChooseRecommendation`
 *   / `onSelectTemplate` / `onBackToInput` / `onExecute`
 *
 * ## ⚠️ 一处**命令式 DOM 读取**原样搬来（轮播滚动联动）
 *
 * 滚动联动要读真实布局（`getBoundingClientRect().width` / `clientWidth` /
 * `scrollLeft`），**不是纯 setState**——读的是 DOM 的当前状态。
 * 搬迁时**逐字保留**，只把 `setRecommendationIndex(...)` 换成 `onScrollToIndex(...)`。
 *
 * ## 实测修正（写 Props 时踩到的）
 *
 * 我最初凭直觉写了 `siteId` 与 `adjustments` 两个 props——**父级根本没有这两个变量**
 * （`siteId` 是 `execute` 里的局部量；设计变量协调结果在 `designTokenResult.adjustments`）。
 * 是 `tsc` 把它们逐条打出来的。**字段语义不许猜**（用户铁律 1）。
 *
 * ## 纯搬家声明
 *
 * JSX 逐字来自拆分前的 generate 页 confirm 块内部，仅做"闭包引用 → props"的机械替换。
 */

import Link from "next/link";
import {
  AlertCircle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Eye, EyeOff, ExternalLink, LoaderCircle, MessageSquareText, Sparkles,
} from "lucide-react";
import type { RefObject } from "react";

import type { SiteDraft } from "@/lib/site-model";

import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import type { ContentCoverageReport } from "@/lib/template-content-coverage";
import type { ContentQualityReport } from "@/lib/content-quality";

/**
 * localStorage 键：`/templates/<id>/preview` 页读它来还原"已填内容预览"。
 *
 * ⚠️ 与 `app/generate/page.tsx` 里的同名常量**必须一致**——
 * 预览页按这个键取值，改名要两边一起改。
 * 实测该键在拆分前**只有 confirm 块使用**，故随块搬来；
 * 父级那份若已无使用点，随本刀删除（见 commit 正文）。
 */
const REAL_PREVIEW_DRAFT_KEY = "sitecraft:real-preview-draft:v1";

/** 与父级 `Intent` 同形（此处不 import 页面类型，避免 components → app 的反向依赖）。 */
export type ConfirmIntent = {
  businessType: string;
  companyName: string;
  industry: string;
  targetAudience: string;
  tone: string;
  coreSections: string[];
  recommendedTemplateId: string;
  summary: string;
  notices?: string[];
  conflicts?: string[];
  limits?: string[];
};
export type ConfirmTemplate = { id: string; name: string; category: string; reason: string };

type Props = {
  intent: ConfirmIntent;
  template: ConfirmTemplate;
  templates: ReadonlyArray<{ id: string; name: string; category: string }>;
  templateOptions: ReadonlyArray<{ id: string; name: string; category: string }>;
  recommendationTemplates: ConfirmTemplate[];
  recommendationIndex: number;
  previewCollapsed: boolean;
  previewDraft: SiteDraft;
  hiddenSections: string[];
  adjusting: boolean;
  busy: boolean;
  progressText: string;
  siteLanguage: "zh" | "en";
  regenerateSiteId: string | null;
  generationCompletion: {
    /** 已生成站点的 id（用于"查看已填内容预览"链接与已保存态判定） */
    siteId: string;
    quality?: ContentQualityReport;
    coverage?: ContentCoverageReport;
  } | null;
  carouselRef: RefObject<HTMLDivElement | null>;
  category: string;
  error: string | null;
  previewFeedback: { section: string; mode: "show" | "hide" } | null;
  /** 设计变量协调结果；null = 无需协调（那一块不渲染） */
  designTokenResult: { adjustments: string[] } | null;
  businessLabels: Record<string, string>;
  audienceLabels: Record<string, string>;
  toneLabels: Record<string, string>;
  sectionsLabels: Record<string, string>;
  onToggleSection: (section: string) => void;
  onChangeLanguage: (language: "zh" | "en") => void;
  onTogglePreviewCollapsed: () => void;
  onPreviewStateChange: (state: "loading" | "ready" | "error") => void;
  onMoveRecommendation: (direction: -1 | 1) => void;
  /** 轮播滚动联动：入参是算好的下标，DOM 读取留在组件内（见文件头） */
  onScrollToIndex: (index: number) => void;
  onChooseRecommendation: (candidate: ConfirmTemplate, index: number) => void;
  onSelectTemplate: (next: ConfirmTemplate, index: number) => void;
  onBackToInput: () => void;
  onExecute: () => void;
};

export function ConfirmStepView({
  intent, template, templates, templateOptions, recommendationTemplates, recommendationIndex,
  previewCollapsed, previewDraft, hiddenSections, adjusting, busy, progressText,
  siteLanguage, regenerateSiteId, generationCompletion, carouselRef,
  category, error, previewFeedback, designTokenResult,
  businessLabels, audienceLabels, toneLabels, sectionsLabels,
  onToggleSection, onChangeLanguage, onTogglePreviewCollapsed, onPreviewStateChange,
  onMoveRecommendation, onScrollToIndex, onChooseRecommendation, onSelectTemplate,
  onBackToInput, onExecute,
}: Props) {
  return (
            <div className="generate-confirm">
              <div className="eyebrow">我理解你要的是</div>
              <h1>{intent.summary}</h1>
              <div className="generate-confirm-grid">
                <div className="template-card generate-intent-card">
                  <div className="generate-intent-row">
                    <h3>意图摘要</h3>
                    <div className="generate-intent-rows">
                      <div><span>行业</span><strong>{businessLabels[intent.businessType] ?? intent.businessType} · {intent.industry}</strong></div>
                      <div><span>受众</span><strong>{audienceLabels[intent.targetAudience] ?? intent.targetAudience}</strong></div>
                      <div><span>语气</span><strong>{toneLabels[intent.tone] ?? intent.tone}</strong></div>
                    </div>
                  </div>
                  <div className="generate-intent-row">
                    <h3>套用到模板的板块</h3>
                    <div className="generate-sections">
                      {intent.coreSections.map((s) => {
                        const isVisible = !hiddenSections.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            className={`generate-toggle ${isVisible ? "on" : "off"}`}
                            aria-pressed={isVisible}
                            title={isVisible ? `点击隐藏「${sectionsLabels[s] ?? s}」板块` : `点击重新显示「${sectionsLabels[s] ?? s}」板块`}
                            onClick={() => onToggleSection(s)}
                          >
                            {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                            <span>{sectionsLabels[s] ?? s}</span>
                            <strong>{isVisible ? "已显示" : "已隐藏"}</strong>
                          </button>
                        );
                      })}
                      <span className="generate-sections-hint">点开关可增删要生成的板块</span>
                    </div>
                  </div>
                </div>
                <div className="generate-template-picker" data-template-carousel>
                  {/* 主预览区：随选中模板切换的大图，AI 内容与色板即时套用（问题 1：点卡时上面有对应变化） */}
                  {template && (
                    <div className={`generate-hero-preview${previewCollapsed ? " collapsed" : ""}`} data-template-hero-preview={template.id}>
                      {!previewCollapsed && (
                        <div className="generate-hero-preview-toolbar" aria-hidden="true">
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-dot" />
                          <span className="generate-hero-preview-url">{template.name} · 真实模板预览</span>
                        </div>
                      )}
                      {!previewCollapsed && (
                        <div className="generate-hero-preview-frame">
                          <OpenSourceTemplateFrame
                            key={`hero-${template.id}`}
                            templateId={template.id}
                            draft={{ ...previewDraft, templateId: template.id }}
                            locale={siteLanguage}
                            variant="preview"
                            onPreviewStateChange={onPreviewStateChange}
                          />
                        </div>
                      )}
                      <div className="generate-hero-preview-meta">
                        <div className="generate-hero-preview-title">
                          <strong>{template.name}</strong>
                          <span>{template.category} · {template.reason || "推荐模板"}</span>
                        </div>
                        <div className="generate-hero-preview-actions">
                          <button
                            type="button"
                            className="generate-preview-collapse-btn"
                            onClick={() => onTogglePreviewCollapsed()}
                            aria-expanded={!previewCollapsed}
                            aria-label={previewCollapsed ? "展开大预览" : "收起大预览"}
                          >
                            {previewCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            {previewCollapsed ? "展开预览" : "收起预览"}
                          </button>
                          <a
                            className="generate-real-preview-link"
                            href={`/templates/${template.id}/preview${generationCompletion?.siteId || regenerateSiteId ? `?siteId=${encodeURIComponent(generationCompletion?.siteId ?? regenerateSiteId ?? "")}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`查看已填内容预览：${template.name}`}
                            onClick={() => {
                              if (generationCompletion?.siteId || regenerateSiteId) return;
                              try {
                                window.localStorage.setItem(REAL_PREVIEW_DRAFT_KEY, JSON.stringify({
                                  savedAt: Date.now(),
                                  draft: { ...previewDraft, templateId: template.id },
                                }));
                              } catch { /* 存储不可用时预览页会诚实展示模板原貌 */ }
                            }}
                          >
                            <ExternalLink size={13} /> 查看已填内容预览
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="generate-preview-heading">
                    <div>
                      <h3>推荐的现有模板</h3>
                      <span>真实模板预览 · AI 内容与设计变量即时套用</span>
                    </div>
                    <div className="generate-carousel-controls">
                      <span>{recommendationIndex + 1} / {recommendationTemplates.length}</span>
                      <button type="button" aria-label="上一个推荐模板" onClick={() => onMoveRecommendation(-1)} disabled={recommendationTemplates.length < 2}><ChevronLeft size={15} /></button>
                      <button type="button" aria-label="下一个推荐模板" onClick={() => onMoveRecommendation(1)} disabled={recommendationTemplates.length < 2}><ChevronRight size={15} /></button>
                    </div>
                  </div>
                  <div
                    className="generate-template-carousel"
                    ref={carouselRef}
                    onScroll={(event) => {
                      const target = event.currentTarget;
                      const first = target.querySelector<HTMLElement>("[data-template-card]");
                      const cardWidth = first?.getBoundingClientRect().width ?? target.clientWidth;
                      if (cardWidth) onScrollToIndex(Math.max(0, Math.min(recommendationTemplates.length - 1, Math.round(target.scrollLeft / (cardWidth + 12)))));
                    }}
                  >
                    {recommendationTemplates.map((candidate, index) => {
                      const isActive = index === recommendationIndex;
                      const candidateDraft = candidate.id === template.id ? previewDraft : { ...previewDraft, templateId: candidate.id };
                      return (
                        <article
                          key={candidate.id}
                          className={`generate-template-option${isActive ? " active" : ""}`}
                          data-template-card={candidate.id}
                          onClick={() => onChooseRecommendation(candidate, index)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChooseRecommendation(candidate, index); } }}
                          role="button"
                          tabIndex={0}
                          aria-label={`选择模板 ${candidate.name}`}
                        >
                          <div className="generate-template-option-label">
                            <span>{isActive ? "当前选择" : "备选模板"}</span>
                            {isActive && <Check size={13} />}
                          </div>
                          <div className="generate-template-option-cover">
                            <OpenSourceTemplateFrame
                              key={`real-${candidate.id}`}
                              templateId={candidate.id}
                              draft={candidateDraft}
                              locale={siteLanguage}
                              variant="thumbnail"
                              onPreviewStateChange={isActive ? onPreviewStateChange : undefined}
                            />
                          </div>
                          <div className="generate-template-option-meta">
                            <strong>{candidate.name}</strong>
                            <span>{candidate.category}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="generate-template-selection-meta" data-template-selection={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <span>{template.category} · {template.reason}</span>
                    </div>
                  </div>
                  <div className="generate-preview-sections" aria-live="polite">
                    {intent.coreSections.map((s) => (
                      <span key={s} className={`${hiddenSections.includes(s) ? "off" : "on"}${previewFeedback?.section === s ? " active" : ""}`}>
                        {hiddenSections.includes(s) ? <EyeOff size={11} /> : <Eye size={11} />}
                        {sectionsLabels[s] ?? s}
                      </span>
                    ))}
                  </div>
                  <select
                    className="generate-select"
                    value={template.id}
                    onChange={(e) => {
                      const selected = templates.find((t) => t.id === e.target.value);
                      if (selected) {
                        const selectedIndex = recommendationTemplates.findIndex((item) => item.id === selected.id);
                        onSelectTemplate({ ...template, id: selected.id, name: selected.name, category: selected.category }, selectedIndex);
                      }
                    }}
                  >
                    {["制造业", "外贸目录", "科技企业", "专业服务"].map((cat) => {
                      const group = templateOptions.filter((t) => t.category === cat);
                      if (!group.length) return null;
                      return (
                        <optgroup key={cat} label={cat === category ? `${cat}（推荐）` : cat}>
                          {group.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              </div>
              {error && <p className="generate-error"><AlertCircle size={13} />{error}</p>}
              {(intent.notices?.length || intent.conflicts?.length || intent.limits?.length) && (
                <div className="generate-tips">
                  {intent.notices?.map((n) => (
                    <div key={n} className="tip notice">ℹ {n}</div>
                  ))}
                  {intent.conflicts?.map((c) => (
                    <div key={c} className="tip conflict">⚠ {c}</div>
                  ))}
                  {intent.limits?.map((l) => (
                    <div key={l} className="tip limit">⛔ {l}</div>
                  ))}
                </div>
              )}
              {designTokenResult?.adjustments.length ? (
                <div className="generate-tips design-coordination-notice" aria-live="polite">
                  {designTokenResult.adjustments.map((adjustment) => (
                    <div key={adjustment} className="tip notice">设计变量已协调：{adjustment}</div>
                  ))}
                </div>
              ) : null}
              {regenerateSiteId && (
                <p className="generate-tips" style={{ marginBottom: 10 }}>
                  <span className="tip notice">ℹ 将在现有站点上重新生成初稿（覆盖当前内容，可通过历史撤销）</span>
                </p>
              )}
              <div className="generate-confirm-actions">
                <button className="secondary-button" disabled={busy} onClick={() => onBackToInput()}>
                  <MessageSquareText size={15} /> 还想改 · 继续对话
                </button>
                <button className="primary-button" disabled={busy} onClick={() => onExecute()}>
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                  {busy ? progressText : "用此模板生成站点内容"} <ArrowRight size={15} />
                </button>
              </div>
            </div>
  );
}
