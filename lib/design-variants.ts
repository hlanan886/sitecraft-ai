import { templateCatalog } from "./template-catalog.ts";
import type { DesignTokens } from "./site-document.ts";

type DesignIntent = {
  colorTone?: string;
  industry?: string;
  tone: string;
};

export type DesignCoordinationResult = {
  tokens: DesignTokens;
  adjustments: string[];
};

const palettes: Record<string, Pick<DesignTokens, "primary" | "secondary" | "accent">> = {
  green: { primary: "#1f5a43", secondary: "#e8f1eb", accent: "#d7ef72" },
  navy: { primary: "#18385f", secondary: "#e7eef7", accent: "#f0bd59" },
  purple: { primary: "#51357a", secondary: "#f0eafb", accent: "#b8ea72" },
  dark: { primary: "#172033", secondary: "#e6ebf3", accent: "#8be0d0" },
  warm: { primary: "#7a3f32", secondary: "#f7ebe5", accent: "#efb96f" },
  neutral: { primary: "#303a3f", secondary: "#edf0ee", accent: "#a8d36f" },
  // 扩充色板：覆盖科技/外贸/创意更多气质
  teal: { primary: "#0f6b6b", secondary: "#e6f4f2", accent: "#ffd166" },
  crimson: { primary: "#8f1d35", secondary: "#faeef1", accent: "#f2b705" },
  indigo: { primary: "#3730a3", secondary: "#eef0fd", accent: "#6ee7b7" },
  graphite: { primary: "#1f2933", secondary: "#f0f2f4", accent: "#f97316" },
  forest: { primary: "#2f4f3a", secondary: "#eef3ef", accent: "#e3b341" },
  sky: { primary: "#0e6ba8", secondary: "#eaf4fb", accent: "#f5b942" },
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

/** 将模型识别出的语义风格收敛为安全、可保存的模板覆盖变量。 */
export function deriveDesignTokenResult(intent: DesignIntent, templateId: string): DesignCoordinationResult {
  const template = templateCatalog.find((item) => item.id === templateId) ?? templateCatalog[0];
  const palette = palettes[intent.colorTone ?? ""] ?? template.colors;
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
    { ...palette, fontStyle, radius, density },
    {
      tone: intent.tone,
      industry: intent.industry,
      fallback: { ...template.colors, fontStyle: "sans", radius: "soft", density: "balanced" },
    },
  );
}

export function deriveDesignTokens(intent: DesignIntent, templateId: string): DesignTokens {
  return deriveDesignTokenResult(intent, templateId).tokens;
}
