/**
 * 批量模板内容覆盖扫描机。
 *
 * 对一个模板列表逐个打开真实 preview 页、注入"标准草稿"、回收 sitecraft:applied 报告，
 * 输出每个槽位的可见填充情况 + 残留 demo。用于快速判定「哪些模板通用引擎已覆盖、
 * 哪些结构偏离需要补专属适配器」，也是适配后回归的同一台验证机。
 *
 * 验收强度（按用户当前要求：功能基本实现即可）：任一 required 槽位在 applied 报告里
 * 可见即算覆盖；不额外断言 maxLength/contact 全字段等严项（完整测试由后续接手）。
 */
import { expect, type Page } from "@playwright/test";

import { cloneDraft, defaultDraft, type SiteDraft } from "../../lib/site-document.ts";
import { getTemplateManifest } from "../../lib/template-manifest.ts";

export type BridgeReport = {
  type: "sitecraft:applied";
  revision: number;
  appliedSlots: string[];
  visibleSlots: string[];
  visibleTextsBySlot: Record<string, string[]>;
  residualDemoSlots: string[];
  missingSlots: string[];
};

/** 每个被测模板都用同一份"完整中文草稿"，保证比较基准一致。 */
export function coverageDraft(templateId: string): SiteDraft {
  const draft = cloneDraft(defaultDraft);
  draft.templateId = templateId;
  draft.revision = 42;
  draft.companyName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  draft.content.hero.subtitle.zh = "为复杂工况提供可追溯的工程答案。";
  draft.content.hero.cta.zh = "查看产品能力";
  draft.content.about.body.zh = "启衡工业为新能源设备提供精密组件与联合工程服务。";
  draft.content.about.title.zh = "工程、制造与交付，一个清晰体系";
  draft.content.features.items = [{
    id: "traceability",
    title: { zh: "全程追溯", en: "Traceability" },
    body: { zh: "从来料到出货保留可核验记录。", en: "Verifiable records from intake to shipment." },
  }];
  draft.content.services.items = [{
    id: "engineering",
    title: { zh: "联合工程", en: "Joint engineering" },
    body: { zh: "围绕应用边界共同完成设计验证。", en: "Validate designs against application constraints." },
  }];
  draft.content.products.title.zh = "产品与能力";
  draft.products = [{
    sku: "QH-100",
    name: { zh: "高稳定连接组件", en: "Stable connector assembly" },
    summary: { zh: "面向高频振动工况。", en: "For high-vibration environments." },
    category: "精密组件",
    status: "published",
    imageColor: "#d7e7d1",
  }];
  draft.content.contact.title.zh = "把需求交给工程团队";
  draft.content.contact.body.zh = "提交图纸与目标交期，工程团队将在一个工作日内回复。";
  draft.content.contact.email = "engineering@qiheng.example";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  return draft;
}

export async function openPreview(page: Page, templateId: string): Promise<void> {
  const response = await page.goto(`/api/templates/${templateId}/preview`);
  expect(response?.status(), `${templateId} preview should be 200`).toBe(200);
}

export function applyDraft(page: Page, templateId: string, draft: SiteDraft): Promise<BridgeReport> {
  return page.evaluate(({ currentTemplateId, currentDraft }) => new Promise<BridgeReport>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${currentTemplateId} bridge_apply_timeout`)), 10_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "sitecraft:applied" || event.data.revision !== currentDraft.revision) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data as BridgeReport);
    };
    window.addEventListener("message", receive);
    window.postMessage({
      type: "sitecraft:content",
      templateId: currentTemplateId,
      siteKey: `coverage-${currentTemplateId}`,
      draft: currentDraft,
      locale: currentDraft.locale,
      variant: "preview",
    }, "*");
  }), { currentTemplateId: templateId, currentDraft: draft });
}

export type TemplateCoverageResult = {
  templateId: string;
  /** required 槽位中在 applied 报告里可见的 */
  covered: string[];
  /** required 槽位中未可见（= 需要专属适配 或 该模板无此结构） */
  missing: string[];
  /** 残留 demo 槽位（= 有内容没被业务文案覆盖掉） */
  residue: string[];
  /** 需要人工看的不支持/结构差异说明（扫描机无法判断的，标 UNVERIFIED） */
  notes: string[];
};

const REQUIRED_TARGETS = [
  "hero.title",
  "about.body",
  "features.items",
  "services.items",
  "products",
  "contact.title",
  "contact.body",
  "contact.email",
  "contact.phone",
  "contact.address",
] as const;

export function summarizeCoverage(report: BridgeReport): { visibleTargets: Set<string>; residue: string[] } {
  const visible = new Set(Object.keys(report.visibleTextsBySlot ?? {}));
  return { visibleTargets: visible, residue: report.residualDemoSlots ?? [] };
}

export function classifyCoverage(templateId: string, report: BridgeReport): TemplateCoverageResult {
  const { visibleTargets, residue } = summarizeCoverage(report);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const target of REQUIRED_TARGETS) {
    if (visibleTargets.has(target)) covered.push(target);
    else missing.push(target);
  }
  return { templateId, covered, missing, residue, notes: [] };
}

export function hasManifest(templateId: string): boolean {
  return Boolean(getTemplateManifest(templateId));
}
