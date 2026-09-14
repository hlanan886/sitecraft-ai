/**
 * 设计变量推导。
 *
 * **2026-09-09 产品决策：不再提供「色系」选择。**
 * 原先有 12 个硬编码色板（green/navy/forest…），用户选一个就覆盖模板自带配色。
 * 实测问题（产品角度）：
 *  1. 概念重复——模板本身已带设计师调好的配色，再选一次色系是同一维度的二次决策；
 *  2. 默认「跟随 AI 判断」= 用模板原生配色，选色系反而**削弱「真实开源模板」的卖点**；
 *  3. 执行不可靠——22 个模板里 9 个的样式是 Tailwind 硬编码色（如 text-blue-600），
 *     CSS 变量管不到，用户选了没反应，比没有这个功能更糟。
 * 因此：**配色一律用模板自带值**（`template.colors`），本模块只保留
 * 「风格 ↔ 字体/圆角/密度」的冲突收敛（coordinateDesignTokens），不再改颜色。
 */
import { templateCatalog } from "./template-catalog.ts";
import type { DesignTokens } from "./site-document.ts";

type DesignIntent = {
  industry?: string;
  tone: string;
};

export type DesignCoordinationResult = {
  tokens: DesignTokens;
  adjustments: string[];
};

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string) {
  const high = Math.max(relativeLuminance(first), relativeLuminance(second));
  const low = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (high + 0.05) / (low + 0.05);
}

/** 收敛模型或模板给出的变量，避免撞色和语义风格冲突。 */
export function coordinateDesignTokens(
  tokens: DesignTokens,
  context: { tone: string; industry?: string; fallback: DesignTokens },
): DesignCoordinationResult {
  const coordinated = { ...tokens };
  const adjustments: string[] = [];

  if (contrastRatio(tokens.primary, tokens.accent) < 1.35) {
    coordinated.primary = context.fallback.primary;
    coordinated.accent = context.fallback.accent;
    adjustments.push("色彩对比不足，已回退模板默认主色与强调色");
  }

  if (context.tone === "technical" && tokens.density === "spacious") {
    coordinated.density = "compact";
    adjustments.push("技术风格与宽松密度冲突，已改为紧凑密度");
  }

  if (tokens.fontStyle === "editorial" && /工业|制造|工程|industrial|manufactur|engineering/i.test(context.industry ?? "")) {
    coordinated.fontStyle = "technical";
    adjustments.push("工业行业与编辑字体冲突，已改为技术字体");
  }

  return { tokens: coordinated, adjustments };
}

/** 将语义风格收敛为安全、可保存的模板覆盖变量。配色一律取模板自带值（见文件头说明）。 */
export function deriveDesignTokenResult(intent: DesignIntent, templateId: string): DesignCoordinationResult {
  const template = templateCatalog.find((item) => item.id === templateId) ?? templateCatalog[0];
  const fontStyle: DesignTokens["fontStyle"] = intent.tone === "editorial"
    ? "editorial"
    : intent.tone === "technical"
      ? "technical"
      : "sans";
  const radius: DesignTokens["radius"] = intent.tone === "minimal" || intent.tone === "technical"
    ? "sharp"
    : intent.tone === "friendly"
      ? "rounded"
      : "soft";
  const density: DesignTokens["density"] = intent.tone === "technical"
    ? "compact"
    : intent.tone === "minimal" || intent.tone === "editorial"
      ? "spacious"
      : "balanced";

  return coordinateDesignTokens(
    { ...template.colors, fontStyle, radius, density },
    {
      tone: intent.tone,
      industry: intent.industry,
      fallback: { ...template.colors, fontStyle: "sans", radius: "soft", density: "balanced" },
    },
  );
}

