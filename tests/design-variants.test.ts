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

test("配色一律取模板自带值（2026-09-09 产品决策：色系选择已移除）", () => {
  // 原先 12 个硬编码色板会让用户覆盖模板配色，实测 9/22 模板根本不生效
  // （Tailwind 硬编码色），且削弱「真实开源模板」卖点 → 已移除。
  const result = variants.deriveDesignTokenResult?.({ tone: "technical", industry: "机械制造" }, "forge");
  assert.ok(result, "deriveDesignTokenResult 应返回结果");
  assert.equal(result!.tokens.primary, "#194c38", "应取 forge 模板自带主色，而非 graphite 色板");
  assert.equal(result!.tokens.fontStyle, "technical");
  assert.equal(result!.tokens.density, "compact");
});
