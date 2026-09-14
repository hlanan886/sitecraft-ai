"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { CheckCircle2, Image as ImageIcon, Link2, Loader2, RotateCcw, Upload, X } from "lucide-react";

/**
 * 「上传截图 / 粘贴网址」→ 建站 的入口弹窗。
 *
 * ## 两条路的产品语义完全不同，所以界面必须让人一眼看出区别
 *
 * | | 上传截图 | 粘贴网址 |
 * |---|---|---|
 * | 产出 | **新模板**（能改，11–13 个编辑位） | 两条子路：**搬一个一样的站**（快但几乎改不了）/ **复刻成新模板** |
 * | 定位 | 客户自己的业务 | 主要给"我有个老站"用 |
 *
 * 界面上把这两件事**并排**放，而不是藏在一个"加号"后面——因为选错那一栏
 * 得到的东西完全不同。这正是计划里"入口不是加号"那条判断的落点。
 *
 * ## 每个异步步骤都必须有可见的状态
 *
 * 自助场景下用户沉默 30 秒就走了。所以：上传 → 解析 → 生成 三步各自有文案，
 * 且**说明白在等什么、大概多久**。不能只显示一个转圈。
 */

type Phase = "idle" | "uploading" | "generating" | "done" | "error";

type GenerateResult = {
  templateId: string;
  siteId: string | null;
  summary: string;
  warnings: string[];
  editable?: number;
  library?: Array<{ role: string; url: string }>;
};

/** 服务端返回的"上次没做完的活儿"。 */
type PendingJobView = {
  jobId: string;
  kind: "template-from-screenshot" | "template-from-url";
  step: string;
  stepLabel: string;
  description: string;
  input: { source: { kind: "upload"; urlPath: string } | { kind: "url"; url: string }; note?: string; suffix?: string };
  result: { templateId: string; siteId: string | null; summary: string } | null;
};

export function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"image" | "url">("image");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [urlMode, setUrlMode] = useState<"static" | "rebuild">("rebuild");
  /**
   * 上次没做完的活儿（断点恢复）。
   *
   * 实测动因（2026-09-11）：传到第 7 张图时刷新，前 6 张的去向**用户一无所知**；
   * 或者生成到一半断网，回来只看到"失败"，不知道是不是白做了。
   */
  const [pending, setPending] = useState<PendingJobView[]>([]);
  const [resuming, setResuming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 打开弹窗时问一次"上次有没有没做完的"
  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates/pending-jobs", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { jobs?: PendingJobView[] } | null) => {
        if (!cancelled) setPending(body?.jobs ?? []);
      })
      .catch(() => {
        // 查不到就不提示——这是锦上添花的功能，不该因为查不到而弹错
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 接着做：用**原来那份输入**重跑一遍。 */
  async function resumeJob(job: PendingJobView) {
    setResuming(job.jobId);
    setPending((items) => items.filter((item) => item.jobId !== job.jobId));
    // 记着已经被放弃，避免重跑时又被列出来
    void fetch(`/api/templates/pending-jobs?jobId=${encodeURIComponent(job.jobId)}`, { method: "DELETE" });
    const endpoint = job.kind === "template-from-url" ? "from-url" : "from-screenshot";
    await generate(
      { source: job.input.source, endpoint },
      { note: job.input.note, ...(endpoint === "from-url" ? { collectLibrary: false } : { withProductImages: false }) },
    );
    setResuming(null);
  }

  /** 不做了：删掉记录（**不动已经产出的模板与站点**）。 */
  function dismissJob(jobId: string) {
    setPending((items) => items.filter((item) => item.jobId !== jobId));
    void fetch(`/api/templates/pending-jobs?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" });
  }

  // Esc 关闭——弹窗的基本礼貌，缺了会让人以为卡住
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "generating" && phase !== "uploading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  const busy = phase === "uploading" || phase === "generating";

  /** 上传截图 → 拿回 `/api/product-images/...` 路径 → 走 B 链路。 */
  async function handleImage(file: File) {
    setPhase("uploading");
    setMessage("正在上传这张图…");
    setDetail("");
    setPreview(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadResponse = await fetch("/api/product-images", { method: "POST", body: form });
      const uploaded = (await uploadResponse.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!uploadResponse.ok || !uploaded?.url) {
        setPhase("error");
        setMessage(uploaded?.error ?? "图片上传失败，换个格式再试试（支持 JPG / PNG / WebP，5MB 以内）。");
        return;
      }
      await generate({ source: { kind: "upload", urlPath: uploaded.url } });
    } catch (error) {
      setPhase("error");
      setMessage(`上传出错了：${error instanceof Error ? error.message : "网络问题"}`);
    }
  }

  /** 网址 → 按用户选的那条子路调对应接口。 */
  async function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (urlMode === "static") {
      await generate({ source: { kind: "url", url: trimmed }, endpoint: "from-url" }, { createSite: true });
    } else {
      await generate({ source: { kind: "url", url: trimmed }, endpoint: "from-screenshot" }, { withProductImages: false });
    }
  }

  async function generate(
    payload: { source: { kind: "upload"; urlPath: string } | { kind: "url"; url: string }; endpoint?: "from-screenshot" | "from-url" },
    extra: Record<string, unknown> = {},
  ) {
    const endpoint = payload.endpoint ?? "from-screenshot";
    /**
     * ⚠️ 两个端点的**请求体形状不同**，必须分别拼（2026-09-13 修）。
     *
     * | 端点 | schema | 形状 |
     * |---|---|---|
     * | `from-screenshot` | `{ source: 二选一 }` | `source.kind === "upload"` 时 `urlPath`；`"url"` 时 `url` |
     * | `from-url` | **顶层 `url`** | `{ url, suffix, createSite, ... }`，**没有 `source`** |
     *
     * 此前两个端点发的是同一份 `{...payload}`，于是"原样搬下来"（static 模式）
     * 必然 `safeParse` 失败 → **400「请求无效」**，路由体根本不执行：
     * 用户点这个按钮看到的就是一句没头没脑的报错。
     * 路由 schema 是权威侧（`app/api/templates/from-url/route.ts`），这里按它拼。
     */
    // 后缀用时间戳避免模板 id 撞名——服务端生成的话撞了只能返 409，
    // 而"名字被占了"对客户是没有意义的错误。
    const suffix = `u${Date.now().toString(36).slice(-5)}`;
    const requestBody =
      endpoint === "from-url"
        ? {
            url: payload.source.kind === "url" ? payload.source.url : payload.source.urlPath,
            suffix,
            note: note.trim() || undefined,
            createSite: true,
            ...extra,
          }
        : { ...payload, suffix, note: note.trim() || undefined, createSite: true, ...extra };

    setPhase("generating");
    setMessage(
      endpoint === "from-url"
        ? "正在把这个网址整个搬下来（抓页面 → 下载图片样式 → 本地化）…"
        : "正在看你发的图（读版面 → 认产品 → 选配色）…",
    );
    setDetail(endpoint === "from-url" ? "大约 20–40 秒" : "大约 10–20 秒");

    try {
      const response = await fetch(`/api/templates/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body = (await response.json().catch(() => null)) as (GenerateResult & { message?: string; detail?: string }) | null;

      if (!response.ok) {
        setPhase("error");
        // 服务端已经把失败翻成人话了，直接用——不要在这里再包一层技术术语
        setMessage(body?.message ?? "生成失败了，换个方式再试试。");
        setDetail(body?.detail ?? "");
        return;
      }
      setResult(body as GenerateResult);
      setPhase("done");
    } catch (error) {
      setPhase("error");
      setMessage(`生成出错了：${error instanceof Error ? error.message : "网络问题"}`);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="dialog-head">
          <div>
            <h2>做一个新模板</h2>
            <p>上传一张截图，或者给一个网址——两种做法得到的东西不一样，见下方说明。</p>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        {phase === "idle" && (
          <div className="dialog-body">
            {/* 断点恢复：上次没做完的活儿放在**最上面**——它比"重新开始"更可能是
                用户这次打开弹窗的原因（他就是回来接着做的）。 */}
            {pending.length > 0 && (
              <div className="resume-list">
                {pending.slice(0, 2).map((job) => (
                  <div className="resume-card" key={job.jobId}>
                    <RotateCcw size={14} />
                    <div>
                      <strong>上次没做完</strong>
                      <span>{job.description}</span>
                    </div>
                    <button className="ghost-button" onClick={() => dismissJob(job.jobId)} disabled={resuming !== null}>
                      不用了
                    </button>
                    <button className="primary-button" onClick={() => void resumeJob(job)} disabled={resuming !== null}>
                      {resuming === job.jobId ? <Loader2 size={13} className="spin" /> : null} 接着做
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="dialog-tabs">
              <button className={mode === "image" ? "active" : ""} onClick={() => setMode("image")}>
                <ImageIcon size={14} /> 上传截图
              </button>
              <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>
                <Link2 size={14} /> 粘贴网址
              </button>
            </div>

            {mode === "image" ? (
              <div className="dialog-pane">
                <button className="dropzone" onClick={() => fileRef.current?.click()}>
                  <Upload size={22} />
                  <strong>选一张网站截图</strong>
                  <span>建议宽度 1000px 以上的整页截图，字看得清才读得准</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleImage(file);
                  }}
                />
                <p className="dialog-hint">
                  会得到一个<strong>能继续编辑的新模板</strong>：首屏、产品、联系方式都能在工作台里改。
                </p>
              </div>
            ) : (
              <div className="dialog-pane">
                <input
                  className="dialog-input"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://你的网站.com"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && url.trim()) void handleUrl();
                  }}
                />
                <div className="dialog-choices">
                  <button className={urlMode === "rebuild" ? "selected" : ""} onClick={() => setUrlMode("rebuild")}>
                    <strong>复刻成新模板</strong>
                    <span>读版面重做一份，能编辑、能维护（推荐）</span>
                    <em>慢一些 · 会调一次模型</em>
                  </button>
                  <button className={urlMode === "static" ? "selected" : ""} onClick={() => setUrlMode("static")}>
                    <strong>原样搬下来</strong>
                    <span>一模一样，但基本改不了——适合"先要个能看的"</span>
                    <em>快 · 不花模型钱</em>
                  </button>
                </div>
                <p className="dialog-hint">
                  搬别人的网站涉及版权，建议只用于<strong>你自己的</strong>站点。
                </p>
              </div>
            )}

            <label className="dialog-note">
              <span>补充说明（可选）</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：这是我们公司自己的旧站，主色是红色"
                maxLength={200}
              />
            </label>

            <footer className="dialog-foot">
              <button className="ghost-button" onClick={onClose}>
                取消
              </button>
              {mode === "url" && (
                <button className="primary-button" disabled={!url.trim()} onClick={() => void handleUrl()}>
                  开始
                </button>
              )}
            </footer>
          </div>
        )}

        {busy && (
          <div className="dialog-body dialog-progress">
            {preview && <img src={preview} alt="预览" className="dialog-thumb" />}
            <Loader2 size={22} className="spin" />
            <strong>{message}</strong>
            {detail && <span>{detail}</span>}
            <p className="dialog-hint">请别关掉这个窗口——中途关掉这次就白做了。</p>
          </div>
        )}

        {phase === "error" && (
          <div className="dialog-body dialog-progress">
            <strong style={{ color: "#b23a3a" }}>{message}</strong>
            {detail && <span className="dialog-detail">{detail}</span>}
            <footer className="dialog-foot">
              <button
                className="ghost-button"
                onClick={() => {
                  setPhase("idle");
                  setMessage("");
                  setDetail("");
                  setPreview(null);
                }}
              >
                换一张试试
              </button>
            </footer>
          </div>
        )}

        {phase === "done" && result && (
          <div className="dialog-body dialog-progress">
            <CheckCircle2 size={24} color="#2e6b4f" />
            <strong>做好了</strong>
            <span>{result.summary}</span>
            {typeof result.editable === "number" && (
              <span className={result.editable <= 3 ? "dialog-warn" : ""}>
                可以编辑的位置：{result.editable} 个{result.editable <= 3 ? "（很少——这个站基本只能看）" : ""}
              </span>
            )}
            {result.warnings.length > 0 && (
              <ul className="dialog-warnings">
                {result.warnings.slice(0, 4).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <footer className="dialog-foot">
              <button className="ghost-button" onClick={onClose}>
                留在模板库
              </button>
              {result.siteId && (
                <button
                  className="primary-button"
                  onClick={() => router.push(`/workspace?siteId=${encodeURIComponent(result.siteId as string)}` as Route)}
                >
                  去编辑这个站
                </button>
              )}
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
