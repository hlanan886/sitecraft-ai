"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Sparkles,
  WandSparkles,
  MessageSquareText,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { templates } from "@/lib/site-model";

const filters = ["全部模板", "制造业", "外贸目录", "科技企业", "专业服务"];

const starterExamples = [
  "做个光伏出口企业的官网，主打欧美，要显得专业可靠",
  "帮我的 SaaS 团队做官网，用户是海外开发者",
  "工业零部件厂的官网，突出质量和服务",
];

export default function TemplatesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("全部模板");
  const [selected, setSelected] = useState("forge");
  const [prompt, setPrompt] = useState("");
  const visible = useMemo(
    () =>
      filter === "全部模板"
        ? templates
        : templates.filter((item) => item.category === filter),
    [filter],
  );
  const goGenerate = (q?: string, templateId?: string) => {
    const params = new URLSearchParams();
    const value = (q ?? prompt).trim();
    if (value) params.set("q", value);
    if (templateId) params.set("templateId", templateId);
    router.push(`/generate${params.toString() ? `?${params.toString()}` : ""}` as Route);
  };
  return (
    <div className="template-page">
      <header className="topbar">
        <div className="breadcrumbs">
          <Link href="/">
            <ArrowLeft size={14} />
          </Link>
          <ChevronRight size={12} />
          <strong>选择一个方向</strong>
        </div>
        <div className="top-actions">
          <span className="save-status">
            <Check size={13} />
            自动保存
          </span>
          <span className="eyebrow" style={{ marginLeft: 7 }}>
            Step 01 / 03
          </span>
        </div>
      </header>
      <main className="page-content">
        <div className="template-intro">
          <div className="eyebrow">22 open-source templates</div>
          <h1>
            先选一个方向，
            <br />
            <span style={{ color: "#2e6b4f" }}>再让 AI 继续。</span>
          </h1>
          <p>
            每个模板都能被一句话驱动：直接说你的业务，AI 会推荐并生成初稿。
          </p>
        </div>
        <div className="template-prompt-band">
          <MessageSquareText size={17} className="template-prompt-icon" />
          <input
            className="template-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="说一句话让 AI 直接建站，例如：做个光伏出口企业的官网，主打欧美"
            maxLength={400}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim()) goGenerate();
            }}
          />
          <button
            className="primary-button"
            disabled={!prompt.trim()}
            onClick={() => goGenerate()}
          >
            <WandSparkles size={14} /> 用这句话建站 <ArrowRight size={14} />
          </button>
        </div>
        <div className="template-prompt-examples">
          {starterExamples.map((ex) => (
            <button key={ex} className="template-chip" onClick={() => goGenerate(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="template-filters">
          {filters.map((item) => (
            <button
              key={item}
              className={`filter ${item === filter ? "active" : ""}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="template-grid">
          {visible.map((template) => (
            <article
              className={`template-card ${selected === template.id ? "selected" : ""}`}
              key={template.id}
              onClick={() => setSelected(template.id)}
            >
              <div className="template-cover template-live-cover">
                <OpenSourceTemplateFrame templateId={template.id} variant="thumbnail" />
                <div className="template-live-badge">本地模板预览 · MIT</div>
                <Link
                  href={`/templates/${template.id}/preview` as Route}
                  className="template-preview-open"
                  onClick={(event) => event.stopPropagation()}
                >
                  预览整页 <ExternalLink size={11} />
                </Link>
              </div>
              <div className="template-info">
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <div className="template-tags">
                  {template.tags.map((tag) => (
                    <span className="template-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="template-ai-profile">
                  <Sparkles size={11} />
                  <span>{template.promptProfile.role}</span>
                </div>
                <div className="template-starter" onClick={(event) => event.stopPropagation()}>
                  <span className="template-starter-label">你可以对 AI 说</span>
                  {template.promptProfile.starters.slice(0, 2).map((starter) => (
                    <button
                      key={starter}
                      className="template-starter-chip"
                      onClick={() => goGenerate(starter, template.id)}
                    >
                      {starter}
                    </button>
                  ))}
                </div>
                <div className="template-source">
                  <span>{template.source.name} · {template.source.framework}</span>
                  <div>
                    <a
                      href={template.source.demoUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      官方演示 <ExternalLink size={10} />
                    </a>
                    <Link
                      href={`/templates/${template.id}/preview` as Route}
                      onClick={(event) => event.stopPropagation()}
                    >
                      预览 <ExternalLink size={10} />
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="template-bottom">
          <Link
            href={`/workspace?template=${selected}`}
            className="primary-button"
          >
            <Sparkles size={15} />
            用这个模板开始对话 <ArrowRight size={15} />
          </Link>
        </div>
      </main>
      <div className="template-selected">
        <div>
          <strong>
            {templates.find((item) => item.id === selected)?.name}
          </strong>
          <small>已选模板 · 可以随时让 AI 换一个方向</small>
        </div>
        <Check size={17} color="#b9f56b" />
      </div>
    </div>
  );
}
