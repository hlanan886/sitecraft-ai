import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Github, Sparkles } from "lucide-react";
import { OpenSourceTemplateFrame } from "@/components/open-source-template-frame";
import { templates } from "@/lib/site-model";

export default async function TemplatePreviewPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const template = templates.find((item) => item.id === templateId);
  if (!template?.source.demoUrl) notFound();

  return (
    <main className="template-preview-page">
      <header className="template-preview-toolbar">
        <div className="template-preview-toolbar-title">
          <Link href="/templates" className="icon-button" aria-label="返回模板列表">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <strong>{template.name}</strong>
            <span>开源原版预览 · {template.source.name} · {template.source.license}</span>
          </div>
        </div>
        <div className="template-preview-toolbar-actions">
          <a className="secondary-button" href={template.source.repoUrl} target="_blank" rel="noreferrer">
            <Github size={14} /> 源码
          </a>
          <a className="secondary-button" href={template.source.demoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> 查看官方演示
          </a>
          <Link className="primary-button" href={`/workspace?template=${template.id}` as Route}>
            <Sparkles size={14} /> 用此模板建站
          </Link>
        </div>
      </header>
      <div className="template-preview-canvas">
        <OpenSourceTemplateFrame templateId={template.id} variant="preview" />
      </div>
    </main>
  );
}
