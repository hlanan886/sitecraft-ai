import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * B2 手抄检测门禁（2026-09-12，债务文档阶段 B）。
 *
 * ## 它要拦的是什么
 *
 * 本轮付过代价的债，第一条就是**平行手写契约**：prompt 里手抄一份枚举/容量，
 * 与 schema 各写各的，改一处必漂。漂了以后模型照着提示词写、schema 照着自己的收，
 * 报错信息还与提示词对不上（2026-09-10 的 `features item 4 does not exist` 即此）。
 *
 * ## 三条规则
 *
 * - **R1 枚举键漂移**：同一批枚举的键集在**两处**（`site-intent.ts` 的
 *   `*Examples` 与 `site-generator.ts` 的 `*Label`）各自字面量声明。键集不一致即红。
 *   这是**跨文件一致性**检查，编不出来，也不会因为改注释而失效。
 * - **R2 竖线拼接的枚举串**：形如 `"features|services|faq"` 的手写列表——应当写成
 *   `${cardSections.join("|")}` 这类派生形式。**派生形式（含 `${}`）一律放行。**
 * - **R3 数值字面量**：手写的字符数/条数上限（应当从 `SLOT_MAX_LENGTH` /
 *   `MAX_COLLECTION_ITEMS` 等常量派生）。
 *
 * ## 白名单
 *
 * ⚠️ **只允许列出既有 T-3 / T-4 项，禁止新增条目**（用户要求）。
 * 新增白名单 = 新增一笔技术债，必须先在 glossary 登记 `T-x`。
 * 白名单按「文件 + 规则 + 片段签名」精确匹配，**不做整文件豁免**——
 * 整文件豁免等于该文件从此不再受检。
 */

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

/** 受检文件（用户点名清单）。 */
const PROMPT_FILES = [
  "lib/site-intent.ts",
  "lib/site-generator.ts",
  "lib/ai-provider.ts",
  "lib/template-catalog.ts",
] as const;

/**
 * 白名单：**只允许既有 T-3 / T-4 项**。
 *
 * 每一项都对应 glossary 里一条已登记的债；新增前先在待办区开 `T-x`。
 */
const WHITELIST: ReadonlyArray<{ file: string; rule: string; signature: string; debt: string }> = [
  // T-3：枚举中文释义维护了两套（site-intent 的 Examples 系、site-generator 的 Label 系）。
  { file: "lib/site-intent.ts", rule: "R3-labels", signature: "businessExamples", debt: "T-3" },
  { file: "lib/site-intent.ts", rule: "R3-labels", signature: "audienceExamples", debt: "T-3" },
  { file: "lib/site-intent.ts", rule: "R3-labels", signature: "toneExamples", debt: "T-3" },
  { file: "lib/site-generator.ts", rule: "R3-labels", signature: "businessLabel", debt: "T-3" },
  { file: "lib/site-generator.ts", rule: "R3-labels", signature: "audienceLabel", debt: "T-3" },
  { file: "lib/site-generator.ts", rule: "R3-labels", signature: "toneLabel", debt: "T-3" },
];

const isWhitelisted = (file: string, rule: string, signature: string) =>
  WHITELIST.some((entry) => entry.file === file && entry.rule === rule && entry.signature === signature);

/** 把文件切成"行数组"，剥掉 `//` 与 `/* *\/` 注释，避免注释里的示例触发误报。 */
function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""));
}

// ---------------------------------------------------------------- R1

/** 从 `const <name>: Record<string, string> = { ... }` 里取键集。 */
function recordKeys(source: string, name: string): string[] | null {
  const lines = codeLines(source);
  const start = lines.findIndex((line) => new RegExp(`const\\s+${name}\\s*:`).test(line));
  if (start < 0) return null;
  const keys: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > start && /^\s{0,2}\};?\s*$/.test(line)) break;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys.length ? keys.sort() : null;
}

const ENUM_PAIRS: ReadonlyArray<{ enums: string; labels: string[] }> = [
  { enums: "businessExamples", labels: ["businessLabel"] },
  { enums: "audienceExamples", labels: ["audienceLabel"] },
  { enums: "toneExamples", labels: ["toneLabel"] },
];

test("R1：枚举键集在两处必须一致（键集漂移即红）", () => {
  const intentSource = read("lib/site-intent.ts");
  const generatorSource = read("lib/site-generator.ts");
  const problems: string[] = [];

  for (const pair of ENUM_PAIRS) {
    const declared = recordKeys(intentSource, pair.enums);
    assert.ok(declared, `site-intent.ts 里找不到 ${pair.enums}——检测器锚点失效，请更新本测试`);
    for (const labelName of pair.labels) {
      const mirrored = recordKeys(generatorSource, labelName);
      assert.ok(mirrored, `site-generator.ts 里找不到 ${labelName}——检测器锚点失效，请更新本测试`);
      if (declared.join(",") !== mirrored.join(",")) {
        problems.push(
          `${pair.enums} ↔ ${labelName} 键集不一致：`
          + `仅前者有 [${declared.filter((k) => !mirrored.includes(k)).join(",")}]，`
          + `仅后者有 [${mirrored.filter((k) => !declared.includes(k)).join(",")}]`,
        );
      }
    }
  }
  assert.deepEqual(problems, [], `枚举键集漂移：\n${problems.join("\n")}`);
});

// ---------------------------------------------------------------- R2

/**
 * 手写的竖线枚举串。**派生形式一律放行**：
 * `${cardSections.join("|")}` 是我们要的写法，正则里先排除含 `${` 的片段。
 */
function handWrittenPipeLists(source: string): string[] {
  const hits: string[] = [];
  for (const line of codeLines(source)) {
    if (line.includes("${")) continue; // 模板插值 = 派生写法，放行
    for (const match of line.matchAll(/"([a-z][a-z0-9_]*(?:\|[a-z][a-z0-9_]*)+)"/g)) {
      hits.push(match[1]);
    }
  }
  return hits;
}

test("R2：不得手写竖线拼接的枚举串（应改用 X.join(\"|\") 派生）", () => {
  const offenders: string[] = [];
  for (const file of PROMPT_FILES) {
    for (const hit of handWrittenPipeLists(read(file))) {
      if (!isWhitelisted(file, "R2-pipe", hit)) offenders.push(`${file}: "${hit}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `发现手写枚举串（应写成 ${"${常量.join(\"|\")}"}）：\n${offenders.join("\n")}`,
  );
});

// ---------------------------------------------------------------- R3

/** 疑似手写的长度/条数上限数值（应当来自 SLOT_MAX_LENGTH / MAX_COLLECTION_ITEMS 等）。 */
const SUSPECT_NUMBERS = /\b(?:15|24|40|80|120|160|240|600|800|1000|2000)\b/;

test("R3：不得手写长度/条数上限（应从契约常量派生）", () => {
  const offenders: string[] = [];
  for (const file of PROMPT_FILES) {
    for (const line of codeLines(file)) {
      if (line.includes("${")) continue; // 派生写法
      if (!SUSPECT_NUMBERS.test(line)) continue;
      // 只关心"出现在提示词文本或字段约束里"的数值，不关心无关算术。
      if (!/(max|limit|不超过|至多|上限|字数|长度|条)/i.test(line)) continue;
      const signature = line.trim().slice(0, 60);
      if (!isWhitelisted(file, "R3-number", signature)) offenders.push(`${file}: ${signature}`);
    }
  }
  assert.deepEqual(offenders, [], `发现手写上限数值：\n${offenders.join("\n")}`);
});

// ---------------------------------------------------------------- 自检

/**
 * 检测器自检（附则 3：门禁必须能失败）。
 *
 * 上面三条断言是"扫真实文件"，如果**检测器本身**坏了（正则写错、锚点找不到），
 * 它们会安静地全绿。所以这里对每个检测器喂**人造坏样本**，证明它确实会命中。
 */
test("检测器自检：三条规则对人参坏样本都必须命中", () => {
  assert.deepEqual(
    handWrittenPipeLists('const x = "features|services";'),
    ["features|services"],
    "R2 检测器对本该命中的样本没反应",
  );
  assert.deepEqual(
    handWrittenPipeLists('const x = `${cardSections.join("|")}`;'),
    [],
    "R2 检测器把派生写法误判成了手写",
  );
  assert.deepEqual(
    recordKeys("const demo: Record<string, string> = {\n  a: \"1\",\n  b: \"2\",\n};", "demo"),
    ["a", "b"],
    "R1 的键集提取器失效",
  );
  assert.equal(
    recordKeys("const demo: Record<string, string> = {\n  a: \"1\",\n};", "missing"),
    null,
    "R1 的键集提取器找不到锚点时应返回 null（好让上面的 assert.ok 报红）",
  );
  assert.ok(SUSPECT_NUMBERS.test("标题不超过 8 个中文字，最多 40 字"), "R3 数值正则失效");
});
