import Link from "next/link";
import { ChevronRight, FileSpreadsheet, PackageOpen, Plus } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { starterProducts } from "@/lib/site-model";

export default function ContentPage() {
  return (
    <div className="app-shell">
      <AppSidebar active="content" />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Link href="/">Workspace</Link>
            <ChevronRight size={12} />
            <strong>内容与商品</strong>
          </div>
          <Link className="primary-button" href="/workspace?import=products">
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
              <strong>{starterProducts.length}</strong>
              <span>商品草稿</span>
            </div>
          </div>
          <div className="product-admin-grid">
            {starterProducts.map((product) => (
              <article className="product-admin-card" key={product.sku}>
                <div
                  className="product-admin-image"
                  style={{ background: `linear-gradient(135deg, ${product.imageColor}, #f8faf7)` }}
                >
                  <PackageOpen size={26} />
                </div>
                <div>
                  <small>{product.sku} · {product.category}</small>
                  <h2>{product.name.zh}</h2>
                  <p>{product.summary.zh}</p>
                </div>
              </article>
            ))}
            <Link className="product-admin-add" href="/workspace?import=products">
              <Plus size={21} />
              <strong>批量导入商品</strong>
              <span>支持 CSV 与 XLSX</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
