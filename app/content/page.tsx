"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, FileSpreadsheet, PackageOpen, Plus } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { normalizeDraft, type Product } from "@/lib/site-model";

export default function ContentPage() {
  // 2026-09-10：此前渲染的是 `starterProducts`（写死的三个演示商品 FM-2401/2402/2403），
  // 用户以为在管理自己的商品，实际看到的是别人的示例。改为读当前站点的真实草稿。
  const [products, setProducts] = useState<Product[] | null>(null);
  const [siteId, setSiteId] = useState("demo");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("siteId");
    const target = fromUrl || "demo";
    setSiteId(target);
    fetch(`/api/sites/${encodeURIComponent(target)}/draft`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("draft_unavailable"))))
      .then((snapshot: { draft?: unknown }) => {
        setProducts(snapshot.draft ? normalizeDraft(snapshot.draft).products : []);
      })
      .catch(() => setProducts([]));
  }, []);

  

  return (
    <div className="app-shell">
      <AppSidebar active="content" siteKey={siteId} />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <ChevronRight size={12} />
            <strong>内容与商品</strong>
          </div>
          <Link className="primary-button" href={`/workspace?siteId=${encodeURIComponent(siteId)}&import=products`}>
            <FileSpreadsheet size={14} /> 导入商品表格
          </Link>
        </header>
        <div className="page-content data-page">
          <div className="data-page-head">
            <div>
              <div className="eyebrow">Content / Catalog</div>
              <h1>内容与商品</h1>
              <p>维护产品目录，导入后可以继续通过 AI 补全和翻译。</p>
            </div>
            <div className="data-kpi">
              <PackageOpen size={18} />
              <strong>{products?.length ?? "—"}</strong>
              <span>商品草稿</span>
            </div>
          </div>
          {products === null ? (
            <p className="modal-copy">正在读取当前站点的商品…</p>
          ) : products.length === 0 ? (
            <p className="modal-copy">当前站点还没有商品。上传 CSV / XLSX 表格导入，或在工作台让 AI 生成。</p>
          ) : (
            <div className="product-admin-grid">
              {products.map((product) => (
                <article className="product-admin-card" key={product.sku}>
                  <div
                    className="product-admin-image"
                    style={product.image
                      ? { background: `center/cover no-repeat url(${product.image})` }
                      : { background: `linear-gradient(135deg, ${product.imageColor}, #f8faf7)` }}
                  >
                    {product.image ? null : <PackageOpen size={26} />}
                  </div>
                  <div>
                    <small>{product.sku} · {product.category}</small>
                    <h2>{product.name.zh}</h2>
                    <p>{product.summary.zh}</p>
                  </div>
                </article>
              ))}
              <Link className="product-admin-add" href={`/workspace?siteId=${encodeURIComponent(siteId)}&import=products`}>
                <Plus size={21} />
                <strong>批量导入商品</strong>
                <span>支持 CSV 与 XLSX</span>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
