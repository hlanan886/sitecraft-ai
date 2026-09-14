/**
 * 提示词里的字段名/枚举**必须来自 schema**，不得手写（阶段 2 契约回归）。
 *
 * ## 为什么要有这个文件
 *
 * 2026-09-12 排查"一句话建站"时发现，同一个概念在**四处**各写一份，且互相漂移：
 *
 * | 概念 | 手写副本 | 权威来源 |
 * |---|---|---|
 * | `set_text` 的 target 白名单 | `ai-provider.ts:599`、`site-generator.ts:245` | `textTargets` |
 * | `update_card` 的 section 枚举 | `ai-provider.ts:307-309`、`:600` | `cardSections` |
 * | `set_section_visibility` 的 section | `ai-provider.ts:311`、`:602` | `sectionKeys` |
 * | 长度可读建议 | 曾在三处写死 15/40 | `SLOT_MAX_LENGTH × POLISH_RATIO` |
 *
 * 前三条的后果不是"不好看"，而是**模型收到与校验器不一致的契约**：
 *  - `update_item` 的提示词只写 `features|services`，**漏了 `faq`**——
 *    而 `faq` 是真能改的（`cardSections` 含它），模型不知道；
 *  - `set_text` 的 target 白名单与 `textTargets` 平行维护，加字段时会漏改一处。
 *
 * 长度那一条已经在 `copy-length-single-source.test.ts` 里锁住了。本文件锁**枚举**。
 *
 * ## 断言策略
 *
 * 不从"函数被调用了"去断言（换个写法就能绕开），而是**从生成出来的提示词文本**上查：
 * 权威来源里的每一项都必须在提示词里出现，且提示词里不得出现权威来源**没有**的项。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildIntentPrompt } from "../lib/site-intent.ts";
import { cardSections, textTargets } from "../lib/site-operations.ts";
import { sectionKeys } from "../lib/site-document.ts";

/** 提示词里出现的一组 `a|b|c` 形式的枚举，取第一个匹配。 */
function firstEnumIn(text: string, pattern: RegExp): string[] | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return match[1].split("|").map((part) => part.trim()).filter(Boolean);
}

test("阶段 2：意图提示词的 section 枚举来自 sectionKeys", () => {
  const prompt = buildIntentPrompt("做个企业官网");

  // 板块清单必须逐个出现（派生自 sectionKeys，不是手写）
  for (const key of sectionKeys) {
    assert.ok(
      prompt.includes(key),
      `意图提示词里缺少板块「${key}」——它应当来自 sectionKeys`,
    );
  }

  // 不得再出现"五个板块"这类**写死的数量**
  assert.doesNotMatch(
    prompt,
    /只有[^。]*五个板块/,
    "板块数量必须由 sectionKeys.length 派生，不能写死",
  );
});

test("阶段 2：意图提示词不否认代码支持的能力", () => {
  /**
   * 阶段 1 冲突 #2 的回归（已修）。这里再锁一次，防止 prompt 重构时又漂回去。
   * `lib/site-generator.ts` 支持 `shape === "blog"`，`template-catalog.ts` 里有
   * `astropaper`/`yukina` 两个真实博客模板。
   */
  const prompt = buildIntentPrompt("我想做一个技术博客");
  assert.doesNotMatch(prompt, /不支持[^。]*博客/, "博客是支持的，不能写进不支持清单");
});

test("阶段 2：卡片类操作的 section 枚举与 cardSections 同源", async () => {
  /**
   * `update_item` 能改的节 = `cardSections`（含 `faq`）。
   *
   * 从 `ai-provider.ts` 的源码里取提示词模板文本——因为提示词是在**运行时**由
   * 函数拼装的，而这里要断言的是"拼装时用的枚举来自权威来源，不是手写"。
   * 用源码扫描是当前可行的最直接办法（也是阶段 2 的起点；
   * 后续若把拼装改成统一派生函数，这条测试应改为直接调用那个函数）。
   */
  const fs = await import("node:fs");
  const path = await import("node:path");
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../lib/ai-provider.ts"),
    "utf8",
  );

  // 找出所有形如 "features|services" 的手写 section 枚举（没有 faq 的那种）
  const handwritten = source.match(/"features\|services"/g) ?? [];
  assert.deepEqual(
    handwritten,
    [],
    `ai-provider.ts 里仍有手写的 "features|services" 枚举（${handwritten.length} 处）——` +
      `它会漏掉 cardSections 里的其它节（当前含 ${cardSections.join("、")}）。` +
      "这些位置应当改为读取 cardSections 派生。",
  );
});

test("阶段 2：set_text 的 target 白名单与 textTargets 同源", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../lib/ai-provider.ts"),
    "utf8",
  );

  /**
   * 手写的长枚举（形如 `"siteName|companyName|industry|goal|hero.title|..."`）
   * 必须消失——它应当由 `textTargets.join("|")` 派生。
   *
   * 判据：源码里不应再出现包含 `textTargets` 中 ≥5 项的**字面量**枚举。
   */
  const literals = source.match(/"[a-z][a-zA-Z.]*(\|[a-zA-Z.]+){4,}"/g) ?? [];
  const offenders = literals.filter((literal) => {
    const parts = literal.replace(/"/g, "").split("|");
    return parts.filter((part) => (textTargets as readonly string[]).includes(part)).length >= 5;
  });

  assert.deepEqual(
    offenders,
    [],
    `ai-provider.ts 里仍有手写的 set_text target 枚举：\n${offenders.join("\n")}\n` +
      "应当改为读取 textTargets 派生（权威来源：lib/site-operations.ts）",
  );
});
