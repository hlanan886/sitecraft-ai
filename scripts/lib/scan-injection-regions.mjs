/**
 * 注入区**扫描器**（2026-09-14 抽出，供门禁与人工复核共用）。
 *
 * ⚠️ **一次性诊断工具 · 非门禁 · 无验收引用** ——
 * 真正的门禁是 `tests/no-backtick-in-adapter-injection.test.ts`，
 * 它 import 本模块。本文件独立成 `.mjs` 的理由：
 * 门禁需要一条**不依赖 TS 运行时**的可复现路径（`node .mjs` 直接跑），
 * 便于给"为什么这么判"当场取证。
 *
 * ## 判据：哪些反引号算"合法收尾"
 *
 * 三种真实形态（都在本仓出现过，少一条就会误报或少报）：
 *   a. **单行模板字面量**：`const f = \`返回字符串\`;` —— 收尾反引号与本行开区反引号同行
 *   b. **缩进收尾**：反引号前的字符是空白（换行/缩进）
 *   c. **`}\`;` 形态**：反引号前恰好一个 `}`（允许前置空白）—— 函数体结束
 *
 * 区内事故形态：`// 注释里有 \`x\`` —— 反引号前是汉字/引号等，三条都不满足。
 */

const TICK = String.fromCharCode(96); // 反引号；用码点写，避免本文件自己被扫

/**
 * 扫出所有「`=` 之后紧邻模板字面量」的区域，返回 `[startLine, endLine]`（1-indexed）。
 * @param {string[]} lines
 * @returns {Array<[number, number]>}
 */
export function templateRegions(lines) {
  const regions = [];
  const opener = new RegExp("=[ \\t]*" + TICK);
  /**
   * 反引号 (r,c) 是否合法收尾。
   *
   * ⚠️ 主判据是「**本行第一个反引号**」——**不能**用"反引号前紧邻空白"。
   * 区内事故真实形态：`// 用 X 会炸`（X=反引号）里，反引号前是汉字「用」，
   * 而 `// 先中文再 X` 里前面又是空格——单看前置字符会左右摇摆。
   * 而"行内第一个反引号"在**所有真实收尾形态**下都成立：
   *
   *   a. `const f = X...X;`  → 本行第一个反引号就是开区那个（同行收尾）
   *   b. `  X;`               → 本行第一个（行首）
   *   c. `}X;`                → 本行第一个
   *   d. `};X;`               → 本行第一个
   *
   * 在**所有真实事故形态**下都不成立——事故反引号前面必有引文/标点/汉字。
   */
  const isCloser = (r, c, openRow, openCol) => {
    const line = lines[r] ?? "";
    if (line.indexOf(TICK) !== c) return false; // 必须是本行第一个
    if (r === openRow && c > openCol) return true; // a 同行收尾
    const before = line.slice(0, c);
    if (before.trim() === "") return true; // b 行首
    if (before.trim() === "}") return true; // c `}X;`
    if (/};?[ \t]*$/.test(before)) return true; // d `};X;`
    return false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = opener.exec(lines[i] ?? "");
    if (!m) continue;
    const start = i + 1;
    const openRow = i;
    const openCol = m.index + m[0].length - 1;
    let j = i;
    let k = openCol + 1;
    let depth = 0;
    let end = -1;
    outer: while (j < lines.length) {
      const line = lines[j] ?? "";
      for (; k < line.length; k += 1) {
        const ch = line[k];
        const prev = k > 0 ? line[k - 1] : "";
        if (ch === "\\" && prev !== "\\") {
          k += 1;
          continue;
        }
        if (ch === "$" && line[k + 1] === "{") {
          depth += 1;
          k += 1;
          continue;
        }
        if (ch === "}" && depth > 0) {
          depth -= 1;
          continue;
        }
        if (ch === TICK && depth === 0 && isCloser(j, k, openRow, openCol)) {
          end = j + 1;
          j += 1;
          break outer;
        }
        // 反引号但非合法收尾 → 必是区内事故：不收尾、不中断，继续走等真收尾符
      }
      j += 1;
      k = 0;
    }
    regions.push([start, end === -1 ? lines.length : end]);
    /* ⚠️ 用 `continue` 跳过已消费的行，**不能写 `i = end - 1`**——
     * 循环尾部的 `i += 1` 会覆盖它，导致区被截断、接着从错误位置继续扫
     * （实测症状：一个 5 行的区被切成 [1,2]，后面还凭空多出两个区）。 */
    i = end === -1 ? lines.length - 1 : end - 1;
    continue;
  }
  return regions;
}

/**
 * 区内（不含两端定界符行）出现反引号即事故。
 * @param {string[]} lines
 * @returns {Array<{ line: number, text: string }>}
 */
export function scanRegions(lines) {
  const findings = [];
  for (const [start, end] of templateRegions(lines)) {
    // 跳过开区那一行：该行上的反引号是定界符本身（可能同行就收了尾）
    for (let ln = start; ln < end - 1 && ln < lines.length; ln += 1) {
      const text = lines[ln] ?? "";
      if (text.includes(TICK)) findings.push({ line: ln + 1, text: text.trim().slice(0, 130) });
    }
  }
  return findings;
}

/**
 * 区内**反斜杠转义**检查（2026-09-14 新增，与反引号同族）。
 *
 * ## 为什么需要它
 *
 * 注入区处于**外层模板字面量内部**。写在那里的 `\s`、`\d`、`\.`、`\'` 等
 * 会被模板字面量**先吃掉一层**：源码里的 `/\s+/` 交付到浏览器变成 `/s+/`。
 * 后果是**静默的**——不报错、不抛异常，正则只是变成了另一个意思。
 *
 * 本轮实测：`cls.split(/\s+/)` 交付成 `cls.split(/s+/)`，
 * 于是 class 不按空白切分、token 判定全假、修复函数**一声不响地不生效**，
 * 排查了整整一轮（够写进 T-28 的教训）。
 *
 * ## 判据
 *
 * 区内出现「反斜杠 + 字母/常见转义符」即报出。
 * 允许的例外：`\`（要的就是一个字面反斜杠）与 `\n`（换行，常见且安全）。
 *
 * @param {string[]} lines
 * @returns {Array<{ line: number, text: string }>}
 */
export function scanBackslashEscapes(lines) {
  const findings = [];
  const BAD = /\[a-zA-Z.]/g;
  for (const [start, end] of templateRegions(lines)) {
    for (let ln = start; ln < end - 1 && ln < lines.length; ln += 1) {
      const text = lines[ln] ?? "";
      /* ⚠️ **不设"合法双反斜杠"逃生口**：区内的 `\\s` 恰恰是陷阱本身
       * （写的人以为在写正则的 \s，交付后就是它），剥掉它等于放过真事故。
       * 一律按「反斜杠 + 字母」报出；确需字面反斜杠时改用 String.fromCharCode。 */
      const hits = text.match(BAD);
      if (hits) {
        findings.push({ line: ln + 1, text: `${hits.join(" ")} :: ${text.trim().slice(0, 110)}` });
      }
    }
  }
  return findings;
}
