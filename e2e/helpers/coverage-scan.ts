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
import { getTemplateManifest, getTemplatePresentation } from "../../lib/template-manifest.ts";
import { evaluateFidelity, type FidelityReport } from "../../lib/template-fidelity-guard.ts";

export type BridgeReport = {
  type: "sitecraft:applied";
  revision: number;
  appliedSlots: string[];
  visibleSlots: string[];
  visibleTextsBySlot: Record<string, string[]>;
  residualDemoSlots: string[];
  missingSlots: string[];
  /** 渲染事实：哪些业务节实际走了通用兜底区（bridge 在 renderGeneratedContent 时 push）。 */
  generatedContentSections?: string[];
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

/**
 * 注入草稿并回收 applied 报告。
 *
 * **必须等到稳定报告**（2026-09-09）：bridge 在 500/1500/3500/6000ms 各重发一次
 * `sitecraft:content`，正是因为首次应用可能早于字体/布局就绪（`resolveHero()` 依赖
 * 「可见的 h1」，布局未就绪时会取不到）。此前只取**第一份**报告，导致 22 模板连跑时
 * 偶发 `hero.title` 缺失 → 门禁假红（实测 shadcn-landing2 单跑通过、连跑失败）。
 *
 * 策略：收集窗口内的所有报告，取「必需槽缺失最少」的一份；缺失相同则取最新。
 * 窗口在出现「无缺失」报告时立即结束，因此正常情况不会等到 6s。
 */
export function applyDraft(page: Page, templateId: string, draft: SiteDraft): Promise<BridgeReport> {
  const requiredTargets = [...requiredTargetsFor(templateId)];
  return page.evaluate(({ currentTemplateId, currentDraft, required }) => new Promise<BridgeReport>((resolve, reject) => {
    const missingCount = (report: BridgeReport) => {
      const visible = new Set(Object.keys(report.visibleTextsBySlot ?? {}));
      return required.filter((target) => !visible.has(target)).length;
    };
    let best: BridgeReport | null = null;
    const settleWindow = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      if (best) resolve(best);
      else reject(new Error(`${currentTemplateId} bridge_apply_timeout`));
    }, 8000);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "sitecraft:applied" || event.data.revision !== currentDraft.revision) return;
      const report = event.data as BridgeReport;
      if (!best || missingCount(report) <= missingCount(best)) best = report;
      if (missingCount(report) === 0) {
        window.clearTimeout(settleWindow);
        window.removeEventListener("message", receive);
        resolve(report);
      }
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
  }), { currentTemplateId: templateId, currentDraft: draft, required: requiredTargets });
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

/**
 * 必需槽位**从 manifest 派生**（此前是硬编码列表——新增行业节必然漏改）。
 * manifest 的 `slot.required` 是权威声明；本文件只消费它。
 */
export function requiredTargetsFor(templateId: string): readonly string[] {
  return getTemplateManifest(templateId)?.slots.filter((slot) => slot.required).map((slot) => slot.target) ?? [];
}

export function summarizeCoverage(report: BridgeReport): { visibleTargets: Set<string>; residue: string[] } {
  const visible = new Set(Object.keys(report.visibleTextsBySlot ?? {}));
  return { visibleTargets: visible, residue: report.residualDemoSlots ?? [] };
}

export function classifyCoverage(templateId: string, report: BridgeReport): TemplateCoverageResult {
  const { visibleTargets, residue } = summarizeCoverage(report);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const target of requiredTargetsFor(templateId)) {
    if (visibleTargets.has(target)) covered.push(target);
    else missing.push(target);
  }
  return { templateId, covered, missing, residue, notes: [] };
}

export function hasManifest(templateId: string): boolean {
  return Boolean(getTemplateManifest(templateId));
}

/**
 * 忠实度判定（2026-09-10 新增，P4 前置）：把覆盖率扫描升级为**忠实度扫描**。
 *
 * 覆盖率只看「必需槽位填没填上」，看不出两类问题：
 *  - **L2 残留**：页面上还留着模板自带的 lorem / 人名（填了槽位不等于覆盖干净）
 *  - **L3 结构**：该走原生排版的节，实际走了通用兜底卡片区
 *
 * 输入正是桥接报告已经在回传的三样：`visibleTextsBySlot` / `generatedContentSections` / `appliedSlots`。
 * 判定声明来自 manifest 的 `presentation`（经 `getTemplatePresentation`，含 card_grid 自动豁免）——
 * 这正是新模板「写一行声明即自动纳入验收」的落点。
 *
 * **基线用途**：P4 的模板进来后跑同一台机器即可回答「这套模板过没过」。
 */
export function evaluateTemplateFidelity(templateId: string, report: BridgeReport): FidelityReport {
  const manifest = getTemplateManifest(templateId);
  const declaredSections = manifest?.slots.map((slot) => slot.target.split(".")[0]) ?? [];
  return evaluateFidelity({
    visibleText: Object.values(report.visibleTextsBySlot ?? {}).flat(),
    sections: [...new Set(declaredSections)],
    generatedSections: report.generatedContentSections ?? [],
    appliedSections: report.appliedSlots ?? [],
    templateId,
    presentation: getTemplatePresentation(templateId),
  });
}
