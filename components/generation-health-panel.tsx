"use client";

import { Activity, Clock3, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GenerationHealthMetrics } from "@/lib/generation-record";

type MetricsPayload = { ok: boolean; enabled: boolean; metrics: GenerationHealthMetrics };
const percent = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (value: number | null) => value === null ? "--" : `${(value / 1000).toFixed(1)}s`;

export function GenerationHealthPanel() {
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generation-records?limit=200", { cache: "no-store" });
      if (!response.ok) throw new Error("读取失败");
      setPayload(await response.json() as MetricsPayload);
    } catch {
      setError("暂时无法读取生成运行数据");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const metrics = payload?.metrics;
  return (
    <section className="generation-health" aria-busy={loading}>
      <div className="generation-health-head">
        <div><div className="eyebrow">AI Generation / Last 200</div><h2>建站运行质量</h2><p>仅统计完整建站终态，局部重生成不计入成功率和耗时。</p></div>
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="刷新建站运行指标" title="刷新指标"><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
      </div>
      {error ? <div className="generation-health-empty error"><TriangleAlert size={15} />{error}</div> : metrics?.sampleSize ? (
        <div className="generation-metrics">
          <div className="generation-metric"><Activity size={15} /><span>交付率</span><strong>{percent(metrics.deliveryRate)}</strong><small>{metrics.delivered} / {metrics.sampleSize} 次</small></div>
          <div className="generation-metric"><Clock3 size={15} /><span>P50 耗时</span><strong>{seconds(metrics.p50LatencyMs)}</strong><small>典型完成时间</small></div>
          <div className="generation-metric"><Clock3 size={15} /><span>P95 耗时</span><strong>{seconds(metrics.p95LatencyMs)}</strong><small>慢请求边界</small></div>
          <div className="generation-metric warning"><TriangleAlert size={15} /><span>部分交付</span><strong>{percent(metrics.partialRate)}</strong><small>占已交付任务</small></div>
          <div className="generation-metric"><Activity size={15} /><span>模板降级</span><strong>{percent(metrics.templateFallbackRate)}</strong><small>占已交付任务</small></div>
          <div className="generation-metric danger"><TriangleAlert size={15} /><span>超时失败</span><strong>{percent(metrics.timeoutRate)}</strong><small>全部完整建站</small></div>
        </div>
      ) : <div className="generation-health-empty"><Activity size={15} />{loading ? "正在读取运行数据…" : payload?.enabled ? "暂无完整建站样本" : "当前环境未启用生产存证"}</div>}
    </section>
  );
}
