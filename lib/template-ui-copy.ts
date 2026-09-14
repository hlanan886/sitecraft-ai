import type { Locale } from "./site-model.ts";

export type TemplateUiCopy = {
  navigation: {
    home: string;
    about: string;
    features: string;
    services: string;
    products: string;
    faq: string;
    contact: string;
  };
  faq: { title: string };
  form: {
    labels: { name: string; email: string; company: string; message: string };
    placeholders: { name: string; email: string; company: string; message: string };
    submit: string;
    success: string;
    error: string;
  };
  footer: { rightsReserved: string; privacy: string; terms: string };
};

export const TEMPLATE_UI_COPY: Record<Locale, TemplateUiCopy> = {
  zh: {
    navigation: {
      home: "首页",
      about: "关于我们",
      features: "核心优势",
      services: "服务能力",
      products: "产品中心",
      faq: "常见问题",
      contact: "联系我们",
    },
    faq: { title: "常见问题" },
    form: {
      labels: { name: "姓名", email: "邮箱", company: "公司", message: "需求说明" },
      placeholders: {
        name: "请输入您的姓名",
        email: "请输入工作邮箱",
        company: "请输入公司名称",
        message: "请描述您的需求",
      },
      submit: "提交询盘",
      success: "已收到您的需求，我们会尽快与您联系。",
      error: "提交失败，请稍后重试。",
    },
    footer: { rightsReserved: "版权所有", privacy: "隐私政策", terms: "使用条款" },
  },
  en: {
    navigation: {
      home: "Home",
      about: "About",
      features: "Features",
      services: "Services",
      products: "Products",
      faq: "FAQ",
      contact: "Contact",
    },
    faq: { title: "Frequently Asked Questions" },
    form: {
      labels: { name: "Name", email: "Email", company: "Company", message: "Message" },
      placeholders: {
        name: "Enter your name",
        email: "Enter your work email",
        company: "Enter your company name",
        message: "Tell us about your needs",
      },
      submit: "Send inquiry",
      success: "We received your request and will be in touch soon.",
      error: "We could not submit your request. Please try again.",
    },
    footer: { rightsReserved: "All rights reserved", privacy: "Privacy", terms: "Terms" },
  },
};

export function getTemplateUiCopy(locale: Locale) {
  return TEMPLATE_UI_COPY[locale];
}
