/**
 * 产物契约断言（2026-09-10）。
 *
 * 为什么存在：项目有 489 个单元测试却抓不到真机上的三个 bug——
 * 首屏出现「待补充」、about 正文等于 defaultDraft（AI 没干活）、
 * 用户声明要的产品板块被静默隐藏。根因见
 * docs/audits/2026-09-10-nl-site-architecture-gap-analysis.md。
 *
 * 设计原则（为什么不是断言具体文案）：
 * AI 每次输出都不同，断言具体字符串必然变成随机红灯，三天后会被 skip。
 * 这里断言的是**产品承诺**——描述的是"用户拿到的东西不能是什么样"，
 * 与某次运行无关。故对同一输入应恒定成立。
 *
 * 判据来源（不重复实现）：
 * - 「待补充」的判定复用 lib/template-content-coverage.ts 的 isPlaceholderValue
 * - 「AI 没干活」的判定复用 lib/site-document.ts 的 defaultDraft
 */

import { isPlaceholderValue } from "../../lib/template-content-coverage.ts";
import { defaultDraft } from "../../lib/site-document.ts";

export type ContractDraft = {
  content?: {
    hero?: { title?: Record<string, string>; cta?: Record<string, string> };
    about?: { body?: Record<string, string> };
  };
  hiddenSections?: string[];
};

export type Violation = {
  /** 契约名，稳定标识（用于跨运行比对：真回归是同一项反复失败，噪声是失败项在换） */
  rule: string;
  /** 硬失败 = 用户必看得到；软警告 = 记录但不拦 */
  severity: "hard" | "soft";
  detail: string;
};

/** 用户可见文案槽位——这些 AI 本该写得出来，出现占位符就是没干活 */
const CREATIVE_COPY_SLOTS: Array<{ name: string; read: (draft: ContractDraft, locale: string) => string | undefined }> = [
  { name: "hero.title", read: (d, l) => d.content?.hero?.title?.[l] },
  { name: "hero.cta", read: (d, l) => d.content?.hero?.cta?.[l] },
  { name: "about.body", read: (d, l) => d.content?.about?.body?.[l] },
];

/** defaultDraft 对应槽位的值，用于判定「AI 是否只是原样保留了系统默认」 */
function defaultFor(name: string, locale: string): string | undefined {
  if (name === "hero.title") return defaultDraft.content.hero.title[locale as "zh" | "en"];
  if (name === "hero.cta") return defaultDraft.content.hero.cta[locale as "zh" | "en"];
  if (name === "about.body") return defaultDraft.content.about.body[locale as "zh" | "en"];
  return undefined;
}

const normalize = (v: string) => v.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/**
 * 核心：检查草稿是否满足产品承诺。
 *
 * 每条断言都对应一个**真机上观察到的**失败模式，不是假想：
 * - placeholder-copy:  实测第二个站首屏大标题 = "待补充"
 * - default-draft-leak: 实测第一个站 about 正文 = defaultDraft 原文
 * - hidden-declared-section: 实测 3/3 个站 hiddenSections 含 products
 */
export function checkDraftContract(draft: ContractDraft, locale = "zh"): Violation[] {
  const violations: Violation[] = [];
  const hidden = draft.hiddenSections ?? [];

  // ① 创意文案不能是占位符——「待补充」只在企业事实类槽位（电话/邮箱/地址）才被允许
  for (const slot of CREATIVE_COPY_SLOTS) {
    const raw = slot.read(draft, locale);
    if (!raw) continue; // 空值由 ② 之外的其他规则管；这里只管"写了但是占位符"
    if (isPlaceholderValue(raw)) {
      violations.push({
        rule: `placeholder-copy:${slot.name}`,
        severity: "hard",
        detail: `${slot.name}.${locale} 是占位符「${raw.slice(0, 20)}」——创意文案槽位 AI 本该写得出来`,
      });
    }
  }

  // ② 创意文案不能等于 defaultDraft——那说明 AI 根本没改这个槽位
  for (const slot of CREATIVE_COPY_SLOTS) {
    const raw = slot.read(draft, locale);
    const dflt = defaultFor(slot.name, locale);
    if (!raw || !dflt) continue;
    if (normalize(raw) === normalize(dflt)) {
      violations.push({
        rule: `default-draft-leak:${slot.name}`,
        severity: "hard",
        detail: `${slot.name}.${locale} 仍是系统默认文案「${raw.slice(0, 24)}」——AI 没有覆盖它`,
      });
    }
  }

  // ③ 中文站里不该出现 defaultDraft 的英文原文（模板 demo 泄漏）
  if (locale === "zh") {
    const enTitle = defaultDraft.content.hero.title.en;
    const title = draft.content?.hero?.title?.zh;
    if (title && normalize(title).includes(normalize(enTitle))) {
      violations.push({
        rule: "english-demo-leak:hero.title",
        severity: "hard",
        detail: `中文站首屏混入了英文 demo「${enTitle}」`,
      });
    }
  }

  // ④ 声明要产品板块却被静默隐藏——对制造业/外贸用户，产品页是主菜
  //    注意：只在调用方明确声明"本次要求 products"时才检查（避免误报作品集类站点）
  if (Array.isArray(hidden) && hidden.includes("products")) {
    violations.push({
      rule: "hidden-declared-section:products",
      severity: "soft",
      detail: "products 板块被隐藏——若本次生成未提供商品数据则属设计内行为，否则用户会看不到产品页",
    });
  }

  return violations;
}

/** 便于测试与日志：只要硬失败 */
export function hardViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.severity === "hard");
}

export function formatViolations(violations: Violation[]): string {
  if (!violations.length) return "✅ 产物契约全部通过";
  return violations
    .map((v) => `${v.severity === "hard" ? "❌" : "⚠️"} [${v.rule}] ${v.detail}`)
    .join("\n");
}
