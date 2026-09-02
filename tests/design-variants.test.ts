import assert from "node:assert/strict";
import test from "node:test";
import type { DesignTokens } from "../lib/site-document.ts";

type CoordinationContext = {
  tone: string;
  industry?: string;
  fallback: DesignTokens;
};
type CoordinationResult = { tokens: DesignTokens; adjustments: string[] };
type Coordinate = (tokens: DesignTokens, context: CoordinationContext) => CoordinationResult;

const variants = await import("../lib/design-variants.ts") as typeof import("../lib/design-variants.ts") & {
  coordinateDesignTokens?: Coordinate;
};

const fallback: DesignTokens = {
  primary: "#1f5a43",
  secondary: "#e8f1eb",
  accent: "#d7ef72",
  fontStyle: "sans",
  radius: "soft",
  density: "balanced",
};

function coordinator() {
  assert.equal(typeof variants.coordinateDesignTokens, "function", "coordinateDesignTokens must be exported");
  return variants.coordinateDesignTokens as Coordinate;
}

test("撞色的主色与强调色回退到模板默认色", () => {
  const result = coordinator()({
    ...fallback,
    primary: "#445566",
    accent: "#465768",
  }, { tone: "professional", fallback });

  assert.equal(result.tokens.primary, fallback.primary);
  assert.equal(result.tokens.accent, fallback.accent);
  assert.ok(result.adjustments.some((item) => item.includes("色彩")));
});

test("technical 与 spacious 冲突时回退为 compact", () => {
  const result = coordinator()({
    ...fallback,
    fontStyle: "technical",
    density: "spacious",
  }, { tone: "technical", fallback });

  assert.equal(result.tokens.density, "compact");
  assert.ok(result.adjustments.some((item) => item.includes("密度")));
});

test("工业行业不使用 editorial 字体", () => {
  const result = coordinator()({
    ...fallback,
    fontStyle: "editorial",
  }, { tone: "editorial", industry: "工业自动化与精密制造", fallback });

  assert.equal(result.tokens.fontStyle, "technical");
  assert.ok(result.adjustments.some((item) => item.includes("字体")));
});

test("扩充色板：graphite 适用于工业/硬核场景", () => {
  const result = variants.deriveDesignTokenResult?.({ tone: "technical", colorTone: "graphite", industry: "机械制造" }, "forge");
  assert.ok(result, "deriveDesignTokenResult 应返回结果");
  assert.equal(result!.tokens.primary, "#1f2933");
  assert.equal(result!.tokens.fontStyle, "technical");
  assert.equal(result!.tokens.density, "compact");
});
