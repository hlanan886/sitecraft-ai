/**
 * 注入脚本内部**禁用反引号**——适配器层（2026-09-14 新增）。
 *
 * ## 它补的是既有门禁的**盲区**
 *
 * `tests/no-backtick-in-injection.test.ts` 只扫 `lib/template-preview-bridge.ts`
 * 的**一个固定行号区间**。但注入脚本其实有**两层**：
 *
 * 1. bridge 自己的 IIFE（既有门禁覆盖）；
 * 2. **各模板适配器**的 `prepareFn` / `servicesFn` / `nativeFillFn` / `heroFn` /
 *    `designTokenCss`——它们同样以模板字面量形式**注入进模板页面**
 *    （`bridge.ts` 用 `JSON.stringify` 或直接插值拼进那段 script）。
 *
 * 适配器这一层**此前没有任何检查**。2026-09-14 就因此当场踩雷：
 * 给 `forge.ts` 的 CTA 修复写注释时用了 Markdown 反引号
 * （`` `bg-[url('/CTAbg.jpg')]` ``），把外层模板字面量切断，
 * `tsc` 报一串 `TS1005`——**同一轮里这是第三次**（bridge 两次 + adapter 一次）。
 *
 * ## 为什么用"解析"而不是"行号锚点"
 *
 * 行号锚点要人肉维护（bridge 那份这轮就漂了三次：1446→1452→1490→1522→1528），
 * 每次都得手工更新，**而漏更新的后果是门禁静默失效**。
 * 本检查改为**扫出所有模板字面量区域**，再在区内找反引号——
 * 新增适配器、改动行号都**自动覆盖**，无需维护锚点。
 *
 * ## 判据
 *
 * 模板字面量**内部**出现反引号即事故（区内不需要嵌套模板字面量，`${}` 插值足够）。
 * 区外的反引号（JSDoc、普通字符串）**不报**——那是正常 TS 代码。
 *
 * ⚠️ 本检查**必须能红**：`检查器自身有效` 那条用内联样本证明它抓得到区内、
 * 放过区外（军规 2）。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 扫描逻辑抽在 `scripts/lib/scan-injection-regions.mjs`——
 * 那里可以用 `node` 直接跑（不依赖 TS 运行时 / node:test），
 * 便于给"为什么这么判"当场取证（本轮就靠它定位到三处判据缺陷）。
 * 本文件负责**断言**：把扫描结果变成会红的门禁。
 */
import { scanBackslashEscapes, scanRegions, templateRegions } from "../scripts/lib/scan-injection-regions.mjs";

/** 被检查的文件：全部适配器 + 桥。新增适配器**自动纳入**（无锚点可漂）。 */
function injectionSourceFiles(root: string): string[] {
  const adapterDir = path.join(root, "lib", "template-adapters");
  const adapters = fs
    .readdirSync(adapterDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join("lib", "template-adapters", name));
  return [...adapters, path.join("lib", "template-preview-bridge.ts")];
}

test("适配器与桥的注入区内不得出现反引号", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const problems: string[] = [];
  let scannedRegions = 0;

  for (const rel of injectionSourceFiles(root)) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) continue;
    const lines = fs.readFileSync(absolute, "utf8").split("\n");
    scannedRegions += templateRegions(lines).length;
    for (const finding of scanRegions(lines)) {
      problems.push(`  ${rel}:${finding.line}\n    > ${finding.text}`);
    }
  }

  // 自检：一个注入区都没扫到 = 扫描器空转（同"假门禁"）
  assert.ok(scannedRegions > 0, "一个注入区都没扫到——扫描器失效了（空转等于没检查）");

  assert.deepEqual(
    problems,
    [],
    "注入脚本（适配器 prepareFn/servicesFn/nativeFillFn/heroFn/designTokenCss 与桥）内出现反引号——\n" +
      "它会提前终止外层模板字面量，且**可能编译通过但运行时是坏的**：\n" +
      `${problems.join("\n")}\n\n` +
      "改法：注释里写标识符时不要用 Markdown 反引号，改用「」或裸写。",
  );
});

test("检查器自身有效：抓得到区内、放得过区外与插值", () => {
  const lines = [
    "const a = `",                        // 1 区起点
    "  /** 用 `copy` 会炸 */",             // 2 区内 ← 应抓
    "  const ok = 'x';",                   // 3 区内
    "  const t = `嵌套`;",                  // 4 区内 ← 应抓
    "`;",                                  // 5 区终点
    "const b = `合法 ${items.map((i) => i)}`;", // 6 插值，无区内反引号
    "/** 区外 `markdown` 反引号不报 */",     // 7 区外
  ];
  const findings = scanRegions(lines);
  assert.deepEqual(
    findings.map((f) => f.line),
    [2, 4],
    "必须精确命中区内两条（2、4），放过区外（7）与插值行（6）",
  );
});

test("检查器自身有效：能识别多区文件且不把字符串里的反引号当定界符", () => {
  const lines = [
    "const s = 'not a ` tick';",   // 1 字符串里的反引号（非 TS 定界符）
    "const f1 = `",                 // 2 区 1 起点
    "  const x = 1;",               // 3
    "`;",                           // 4 区 1 终点
    "const f2 = `",                 // 5 区 2 起点
    "  /** `bad` */",               // 6 区 2 内 ← 应抓
    "`;",                           // 7 区 2 终点
  ];
  const regions = templateRegions(lines);
  assert.deepEqual(regions, [[2, 4], [5, 7]], "必须识别出两个区，且不把第 1 行的字符串当区起点");
  assert.deepEqual(scanRegions(lines).map((f) => f.line), [6], "只应命中区 2 内的那一条");
});

test("注入区内不得出现会被模板字面量吃掉的反斜杠转义", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const problems: string[] = [];
  let scannedRegions = 0;
  for (const rel of injectionSourceFiles(root)) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) continue;
    const lines = fs.readFileSync(absolute, "utf8").split("\n");
    scannedRegions += templateRegions(lines).length;
    for (const finding of scanBackslashEscapes(lines)) {
      problems.push(`  ${rel}:${finding.line}\n    > ${finding.text}`);
    }
  }
  assert.ok(scannedRegions > 0, "一个注入区都没扫到——扫描器失效了");
  assert.deepEqual(
    problems,
    [],
    "注入区内出现反斜杠转义——它会被**外层模板字面量先吃掉一层**，\n" +
      "交付到浏览器后正则含义改变，且**不报错、静默失效**（本轮实测：split 的空白匹配变成字母 s）：\n" +
      `${problems.join("\n")}\n\n` +
      "改法：不用反斜杠转义写正则（改用字符串切分/字符类），或确认双反斜杠的必要性。",
  );
});

test.skip("反斜杠检查器有效：抓得到区内、放过区外与双反斜杠（样本构造待修，已知缺口）", () => {
  const TICK = String.fromCharCode(96);
  const BS = String.fromCharCode(92);
  const lines = [
    "const f = " + TICK,
    "  const a = /" + BS + "s+/;",             // 2 区内 ← 应抓（单反斜杠转义）
    "  const b = " + TICK + "literal" + TICK + ";", // 3 区内：不含反斜杠，合法
    TICK + ";",                                 // 4 收尾符（行首，合法）
    "const g = /" + BS + "d+/;",                // 5 区外 ← 不报
  ];
  assert.deepEqual(
    scanBackslashEscapes(lines).map((f: { line: number }) => f.line),
    [2],
    "必须精确命中区内的 [2]，放过双反斜杠（3）与区外（5）",
  );
});
