"use client";

import type { CSSProperties, FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Cpu,
  Factory,
  Globe2,
  Image as ImageIcon,
  Mail,
  MapPin,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { getTemplate, type Locale, type SiteDraft } from "@/lib/site-model";

export type SiteTargetHandler = (label: string, prompt: string) => void;

type SiteRendererProps = {
  draft: SiteDraft;
  locale: Locale;
  mode?: "thumbnail" | "preview" | "published";
  onSelectTarget?: SiteTargetHandler;
  onSubmitLead?: (event: FormEvent<HTMLFormElement>) => void;
  onLocaleChange?: (locale: Locale) => void;
  submitted?: boolean;
};

const copy = {
  zh: {
    nav: ["关于", "能力", "产品", "联系"],
    contact: "联系我们",
    about: "了解我们",
    products: "产品能力",
    productLabel: "项产品",
    eyebrow: "我们的能力",
    aboutTitle: "为复杂项目，提供确定答案。",
    aboutBody:
      "我们把策略、工程与交付能力放在同一个系统里，让客户更快理解价值，也让每一次合作更清晰。",
    serviceTitle: "从第一次沟通，到持续交付。",
    services: ["需求与策略", "方案与实施", "交付与支持"],
    contactEyebrow: "开始一个项目",
    contactTitle: "说说你的下一件事。",
    contactBody: "留下联系方式，我们会在一个工作日内与你联系。",
    name: "姓名",
    email: "工作邮箱",
    company: "公司名称",
    message: "项目需求",
    send: "发送需求",
    success: "已收到你的需求。",
    successBody: "我们的团队会尽快与你联系。",
  },
  en: {
    nav: ["About", "Capabilities", "Products", "Contact"],
    contact: "Get in touch",
    about: "About us",
    products: "Product capabilities",
    productLabel: "products",
    eyebrow: "Our capabilities",
    aboutTitle: "Certainty for complex projects.",
    aboutBody:
      "We bring strategy, engineering and delivery into one clear system so customers understand the value and every engagement moves with confidence.",
    serviceTitle: "From first conversation to continuous delivery.",
    services: ["Discover and define", "Design and deliver", "Support and grow"],
    contactEyebrow: "Start a project",
    contactTitle: "Tell us what comes next.",
    contactBody: "Leave your details and our team will reply within one business day.",
    name: "Name",
    email: "Work email",
    company: "Company",
    message: "Project requirements",
    send: "Send request",
    success: "We received your request.",
    successBody: "Our team will be in touch soon.",
  },
} as const;

export function SiteRenderer({
  draft,
  locale,
  mode = "preview",
  onSelectTarget,
  onSubmitLead,
  onLocaleChange,
  submitted = false,
}: SiteRendererProps) {
  const template = getTemplate(draft.templateId);
  const text = copy[locale];
  const headline = draft.content.hero.title[locale];
  const subtitle = draft.content.hero.subtitle[locale];
  const visibleProducts = mode === "thumbnail" ? draft.products.slice(0, 3) : draft.products;
  const select = (label: string, prompt: string) => () =>
    onSelectTarget?.(label, prompt);
  const style = {
    "--site-primary": template.colors.primary,
    "--site-secondary": template.colors.secondary,
    "--site-accent": template.colors.accent,
  } as CSSProperties;

  return (
    <div
      className={`rendered-site rendered-site-${template.id} rendered-site-${mode}`}
      style={style}
      data-template={template.id}
      data-template-name={template.name}
    >
      <header className="rs-header">
        <a className="rs-logo" href="#top" aria-label={`${draft.companyName} 首页`}>
          <span className="rs-logo-mark" />
          <strong>{draft.companyName}</strong>
        </a>
        <nav aria-label={locale === "zh" ? "站点导航" : "Site navigation"}>
          <a href="#about">{draft.navigation.about[locale]}</a>
          <a href="#services">{draft.navigation.services[locale]}</a>
          <a href="#products">{draft.navigation.products[locale]}</a>
          <a href="#contact">{draft.navigation.contact[locale]}</a>
        </nav>
        <div className="rs-header-actions">
          {onLocaleChange && (
            <div className="rs-locale" aria-label="Language switcher">
              <button
                className={locale === "zh" ? "active" : ""}
                type="button"
                onClick={() => onLocaleChange("zh")}
              >
                中
              </button>
              <button
                className={locale === "en" ? "active" : ""}
                type="button"
                onClick={() => onLocaleChange("en")}
              >
                EN
              </button>
            </div>
          )}
          <button
            className="rs-button rs-button-small"
            type="button"
            onClick={select("导航联系按钮", "优化导航栏联系按钮和转化文案")}
          >
            {text.contact} <ArrowUpRight size={13} />
          </button>
        </div>
      </header>

      <main>
        <section id="top" className="rs-hero">
          <div className="rs-hero-copy">
            <div className="rs-kicker">
              <span>{String(template.id.length).padStart(2, "0")}</span>
              {draft.industry} / {template.source.name}
            </div>
            <h1>
              {headline.split("\n").map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            <p>{subtitle}</p>
            <div className="rs-hero-actions">
              <button
                className="rs-button"
                type="button"
                onClick={select("首页首屏", "优化首页首屏标题、说明和主行动按钮")}
              >
                {draft.content.hero.cta[locale]}
                <ArrowRight size={14} />
              </button>
              <button
                className="rs-text-button"
                type="button"
                onClick={select("关于我们入口", "完善关于我们内容，并强化企业可信度")}
              >
                {text.about} <ArrowUpRight size={13} />
              </button>
            </div>
          </div>

          <div className="rs-hero-visual" aria-hidden="true">
            <div className="rs-visual-toolbar">
              <span />
              <span />
              <span />
              <small>LIVE / {template.source.framework}</small>
            </div>
            <div className="rs-visual-main">
              <div className="rs-visual-index">01</div>
              <div>
                <small>{draft.products[0]?.category ?? "CAPABILITY"}</small>
                <strong>
                  {draft.products[0]
                    ? draft.products[0].name[locale]
                    : text.products}
                </strong>
              </div>
              <Factory size={42} strokeWidth={1.25} />
            </div>
            <div className="rs-visual-grid">
              <span><Cpu size={17} /> ENGINEERING</span>
              <span><Globe2 size={17} /> GLOBAL</span>
              <span><ShieldCheck size={17} /> VERIFIED</span>
            </div>
          </div>
        </section>

        <section className="rs-trust-strip" aria-label="关键能力">
          <span><Zap size={14} /> RESPONSIVE DELIVERY</span>
          <span><ShieldCheck size={14} /> QUALITY SYSTEM</span>
          <span><Globe2 size={14} /> GLOBAL SERVICE</span>
          <span><Sparkles size={14} /> AI READY</span>
        </section>

        <section id="about" className="rs-about">
          <div className="rs-section-label">01 / {text.eyebrow}</div>
          <div className="rs-about-copy">
            <h2>{draft.content.about.title[locale]}</h2>
            <p>{draft.content.about.body[locale]}</p>
          </div>
          <div className="rs-metric">
            <strong>24/7</strong>
            <span>{locale === "zh" ? "持续响应" : "Continuous response"}</span>
          </div>
        </section>

        <section id="products" className="rs-products">
          <div className="rs-section-heading">
            <div>
              <div className="rs-section-label">02 / CATALOG</div>
              <h2>{draft.content.products.title[locale]}</h2>
            </div>
            <span>{String(draft.products.length).padStart(2, "0")} {text.productLabel}</span>
          </div>
          <div className="rs-product-grid">
            {visibleProducts.map((product, index) => (
              <button
                className="rs-product"
                type="button"
                key={product.sku}
                onClick={select(
                  `商品 ${product.name.zh}`,
                  `优化商品 ${product.name.zh} 的名称、简介和卖点`,
                )}
              >
                <div
                  className="rs-product-image"
                  style={{ backgroundColor: product.imageColor }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <ImageIcon size={34} strokeWidth={1.15} />
                </div>
                <div className="rs-product-copy">
                  <small>{product.sku} / {product.category}</small>
                  <strong>{product.name[locale]}</strong>
                  <p>{product.summary[locale]}</p>
                  <ArrowUpRight size={16} />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section id="services" className="rs-services">
          <div className="rs-section-label">03 / PROCESS</div>
          <h2>{draft.content.services.title[locale]}</h2>
          <div className="rs-service-grid">
            {draft.content.services.items.map((service, index) => (
              <article key={service.id}>
                <span>0{index + 1}</span>
                <strong>{service.title[locale]}</strong>
                <p>{service.body[locale]}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="rs-contact">
          <div className="rs-contact-copy">
            <div className="rs-section-label">04 / {text.contactEyebrow}</div>
            <h2>{draft.content.contact.title[locale]}</h2>
            <p>{draft.content.contact.body[locale]}</p>
            <div className="rs-contact-meta">
              <span><Mail size={15} /> {draft.content.contact.email}</span>
              <span><MapPin size={15} /> {draft.content.contact.address[locale]}</span>
            </div>
          </div>
          <form
            className="rs-form"
            onSubmit={onSubmitLead ?? ((event) => event.preventDefault())}
          >
            {submitted ? (
              <div className="rs-success">
                <Check size={24} />
                <strong>{text.success}</strong>
                <span>{text.successBody}</span>
              </div>
            ) : (
              <>
                <label>{text.name}<input name="name" required /></label>
                <label>{text.email}<input name="email" type="email" required /></label>
                <label>{text.company}<input name="company" /></label>
                <label>{text.message}<textarea name="message" rows={4} required /></label>
                <input className="honeypot" name="website" tabIndex={-1} autoComplete="off" />
                <button className="rs-button" type="submit">
                  {text.send} <Send size={14} />
                </button>
              </>
            )}
          </form>
        </section>
      </main>

      <footer className="rs-footer">
        <strong>{draft.companyName}</strong>
        <span>{template.name} / OPEN SOURCE {template.source.license}</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

function slugCompany(companyName: string) {
  return (
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company"
  );
}
