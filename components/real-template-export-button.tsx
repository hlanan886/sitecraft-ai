"use client";

import { CheckCircle2, Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  type TemplateExportResult,
  validateTemplateExportResult,
} from "@/lib/template-export-contract";

type RealTemplateExportButtonProps = {
  frameId: string;
  siteId: string;
  templateId: string;
  revision: number;
  disabled?: boolean;
};

type ExportState =
  | { status: "idle" }
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function downloadHtml(fileName: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function RealTemplateExportButton({
  frameId,
  siteId,
  templateId,
  revision,
  disabled = false,
}: RealTemplateExportButtonProps) {
  const [state, setState] = useState<ExportState>({ status: "idle" });

  const exportTemplate = () => {
    const frame = document.getElementById(frameId);
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
      setState({ status: "error", message: "真实模板预览尚未就绪。" });
      return;
    }
    const frameWindow = frame.contentWindow;
    const requestId = crypto.randomUUID();
    setState({ status: "working", message: "正在内联模板资源…" });
    const receive = (event: MessageEvent<TemplateExportResult>) => {
      if (event.source !== frameWindow || event.data?.type !== "sitecraft:export-result" || event.data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      const validation = validateTemplateExportResult(event.data, { requestId, templateId, siteId, revision });
      if (!validation.ok || !validation.value) {
        setState({ status: "error", message: "导出失败：" + (validation.error ?? "结果校验失败") });
        return;
      }
      downloadHtml(validation.value.fileName, validation.value.html);
      setState({ status: "success", message: "真实模板已下载（" + (validation.value.bytes / 1_000_000).toFixed(2) + " MB）" });
    };
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      setState({ status: "error", message: "导出超时，模板没有返回完整文件。" });
    }, 60_000);
    window.addEventListener("message", receive);
    frameWindow.postMessage({ type: "sitecraft:export-request", requestId, templateId, siteId, revision }, "*");
  };

  const working = state.status === "working";
  return (
    <div className="real-template-export-control" aria-live="polite">
      <button
        type="button"
        className="button button-primary"
        onClick={exportTemplate}
        disabled={disabled || working}
        title="下载当前真实模板的离线单文件"
      >
        {working ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : <Download aria-hidden="true" size={17} />}
        {working ? "正在导出" : "下载真实模板"}
      </button>
      {state.status !== "idle" ? (
        <span className={"real-template-export-status " + state.status}>
          {state.status === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}
          {state.status === "error" ? <TriangleAlert aria-hidden="true" size={15} /> : null}
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
