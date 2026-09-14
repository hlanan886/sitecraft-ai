import assert from "node:assert/strict";
import test from "node:test";

import { extractStreamingSnippets, formatGenerationProgress, formatStreamingPreview, getGenerationProgress } from "../lib/generation-experience.ts";

test("formats generation progress as a bounded visible percentage", () => {
  assert.equal(formatGenerationProgress(-2), "0%");
  assert.equal(formatGenerationProgress(42.6), "43%");
  assert.equal(formatGenerationProgress(100), "100%");
  assert.equal(formatGenerationProgress(120), "100%");
});

test("generation progress increases with completed sections and reaches 100 only at terminal", () => {
  const input = {
    phase: "content" as const,
    sections: ["hero", "about", "contact"],
    completedSections: [],
    failedSections: [],
    elapsedMs: 0,
  };
  const initial = getGenerationProgress(input);
  const oneSection = getGenerationProgress({ ...input, completedSections: ["hero"] });
  const allSections = getGenerationProgress({ ...input, completedSections: ["hero", "about", "contact"] });

  assert.ok(initial < oneSection);
  assert.ok(oneSection < allSections);
  assert.ok(allSections < 100);
  assert.equal(getGenerationProgress({ ...input, completedSections: ["hero", "about", "contact"], terminal: true }), 100);
});

// ===== 流式进度：从半截 JSON 中提取可读片段（2026-09-10 用户要求流式为主） =====

test("extractStreamingSnippets: 从流式 JSON 中取已完整的中文正文", () => {
  const partial = '{"summary":"更新首屏","operations":[{"op":"set_text","target":"hero.title","locale":"zh","value":"精密制造，稳定交付"},{"op":"set_te';
  const snippets = extractStreamingSnippets(partial);
  assert.deepEqual(snippets, ["精密制造，稳定交付"]);
});

test("extractStreamingSnippets: 跳过正在写入的半截值（避免文字跳变）", () => {
  // 末尾 "科技创新，驱动未来" 只有开引号没有闭引号 → 不应出现
  const partial = '{"operations":[{"value":"可靠交付，全球服务"},{"value":"科技创新，驱动未来';
  const snippets = extractStreamingSnippets(partial);
  assert.deepEqual(snippets, ["可靠交付，全球服务"]);
});

test("extractStreamingSnippets: 不含标识符/操作名/语言码等非正文", () => {
  const partial = '{"op":"set_text","target":"hero.subtitle","locale":"zh","section":"about","value":"面向全球客户的工程服务"}';
  const snippets = extractStreamingSnippets(partial);
  assert.deepEqual(snippets, ["面向全球客户的工程服务"]);
});

test("extractStreamingSnippets: 英文句子（含空格）可提取，纯短词不行", () => {
  assert.deepEqual(extractStreamingSnippets('{"value":"Reliable engineering for global customers"}'), ["Reliable engineering for global customers"]);
  assert.deepEqual(extractStreamingSnippets('{"value":"ok"}'), []);
});

test("extractStreamingSnippets: 空输入与纯结构安全返回", () => {
  assert.deepEqual(extractStreamingSnippets(""), []);
  assert.deepEqual(extractStreamingSnippets('{"operations":['), []);
});

test("formatStreamingPreview: 拼成单行并截断，无内容返回 null", () => {
  assert.equal(formatStreamingPreview([]), null);
  assert.equal(formatStreamingPreview(["", "  "]), null);
  assert.equal(formatStreamingPreview(["可靠交付"]), "正在生成：可靠交付");
  const long = formatStreamingPreview(["一字".repeat(40)]);
  assert.ok(long && long.startsWith("正在生成：") && long.endsWith("…"));
  assert.ok(long.length < 60);
});
