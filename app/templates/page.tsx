"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { templates } from "@/lib/site-model";

const filters = ["全部模板", "制造业", "外贸目录", "科技企业", "专业服务"];

export default function TemplatesPage() {
  const [filter, setFilter] = useState("全部模板");
  const [selected, setSelected] = useState("forge");
  const visible = useMemo(
    () =>
      filter === "全部模板"
        ? templates
        : templates.filter((item) => item.category === filter),
    [filter],
  );
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
          <div className="eyebrow">16 open-source templates · MIT</div>
          <h1>
            先选一个方向，
            <br />
            <span style={{ color: "#2e6b4f" }}>再让 AI 继续。</span>
          </h1>
          <p>
            每张卡片直接加载上游项目的官方页面效果。选定后，AI 会遵循该模板独立的
            结构、内容密度和视觉约束来修改，不会把它替换成统一的自制页面。
          </p>
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
                <div className="template-live-badge">开源原版 · MIT</div>
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
                <div className="template-source">
                  <span>
                    {template.source.name} · {template.source.framework}
                  </span>
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
