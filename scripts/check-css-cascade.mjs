/**
 * CSS 级联比对：给定一个选择器，逐属性比出「git HEAD 版本」与「当前工作区版本」的
 * 计算值差异。
 *
 * ## 为什么需要它
 *
 * 2026-09-11（⑤）合并 `.secondary-button` 的重复定义时，**差点漏掉
 * `justify-content: center`**——它是唯一一条"只由共享基础规则
 * （`.primary-button, .secondary-button`）提供、不被后面那条覆盖"的属性。
 * 当时凭印象对了几条主要属性就准备收工，是写了这个脚本才发现的。
 *
 * **纪律**：合并同名/同作用域的 CSS 规则时，不能只看"主要那几条对上了"，
 * 必须逐属性对一遍计算值。少一条 `justify-content` 在页面上是按钮文字不居中——
 * 看得见，但没人会想到去查它。
 *
 * ## 用法
 *
 *   node scripts/check-css-cascade.mjs .secondary-button
 *   node scripts/check-css-cascade.mjs ".btn, .btn-primary"   # 支持逗号分隔的选择器组
 *   node scripts/check-css-cascade.mjs .card --ref HEAD~1      # 换基线
 *
 * 退出码 0 = 逐属性相同；1 = 有差异（差异会打印出来）。
 *
 * ## 它不做什么（避免误用）
 *
 * - **不解析 `@media`**：媒体查询里的规则被整块剥掉，只比顶层规则。
 *   要验响应式得改这里加参数。
 * - **不算层叠权重**：只按"文档顺序后者胜"合并。**同一选择器内**这是对的；
 *   跨选择器（`.a .b` vs `.b`）它会把后者当赢家，可能与浏览器不同。
 *   **用它比"同一个选择器的两条规则"是准的**，那正是它被造出来的场景。
 * - **不展开简写**：`border: 1px solid red` 与 `border-color: red` 在它眼里是
 *   两个不同的属性名。合并规则时若把简写拆成了长写，它会报差异——**这是提醒**，
 *   不是误报，人应该去看一眼是不是真的等价。
 * - **不解析 `var()`**：`var(--text-md)` 与 `14px` 会报成差异，除非值字面相同。
 *   传 `--resolve-vars` 会把 `:root` 里的变量替换进去（只做一层）。
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const selector = args.find((a) => !a.startsWith("--"));
const refFlag = args.indexOf("--ref");
const ref = refFlag >= 0 ? args[refFlag + 1] : "HEAD";
const resolveVars = args.includes("--resolve-vars");
const file = "app/globals.css";

if (!selector) {
  console.error("用法：node scripts/check-css-cascade.mjs <选择器> [--ref HEAD] [--resolve-vars]");
  process.exit(2);
}

/** 目标选择器组（逗号分隔，去空白） */
const wanted = selector.split(",").map((s) => s.trim()).filter(Boolean);

let before;
try {
  before = execSync(`git show ${ref}:${file}`, { encoding: "utf8" });
} catch {
  console.error(`读不到 ${ref}:${file}——确认 git 里有这个版本，且当前在仓库根目录`);
  process.exit(2);
}
const after = readFileSync(file, "utf8");

/** 去掉注释 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 剥掉所有 @media 块（顶层规则的判定才准） */
function stripMedia(css) {
  const spans = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at < 0) break;
    let depth = 0;
    const open = css.indexOf("{", at);
    if (open < 0) break;
    for (let k = open; k < css.length; k++) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") {
        depth--;
        if (depth === 0) {
          spans.push([at, k + 1]);
          i = k + 1;
          break;
        }
      }
    }
    // 防御：@media 没闭合就跳出，避免死循环
    if (open >= css.length) break;
  }
  const chars = css.split("");
  for (const [s, e] of spans) for (let k = s; k < e; k++) chars[k] = " ";
  return chars.join("");
}

/** 收集顶层规则（选择器 + 声明块 + 文档顺序） */
function topLevelRules(css) {
  const clean = stripMedia(stripComments(css));
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    /**
     * 剥掉选择器前面残留的 **以 `;` 结尾的语句**（`@import ...;`）。
     *
     * 第一版没剥，于是 `:root` 被粘成 `@import url(...); :root`，
     * `rootVars()` 一条都取不到——**`--resolve-vars` 静默失效**，
     * 表现为"两边都是变量，跳过"。变量存在时不该跳过，
     * 所以这个 bug 会让校验器**漏报**，比误报更危险。
     */
    const raw = m[1];
    const sel = raw.slice(raw.lastIndexOf(";") + 1).trim().replace(/\s+/g, " ");
    rules.push({ sel, decl: m[2], order: m.index });
  }
  return rules;
}

/**
 * 简写 → 长写展开。
 *
 * ## 为什么必须做
 *
 * 第一版没做，于是本脚本对 `.secondary-button` 报了一个**假差异**：
 * HEAD 里的 `border-color: var(--line)` 被后面那条 `border: 1px solid #e2e8f0`
 * 简写覆盖（浏览器里是 #e2e8f0），而工作区那版只写了简写、没有这条长写，
 * 于是脚本说"HEAD 有 border-color、工作区没有"。
 *
 * **浏览器里两者一模一样**。一个会误报的校验脚本比没有更糟——
 * 它训练人忽略它的输出。所以这里把简写拆开再比。
 *
 * 只展开**边界清晰**的简写（`border` / `border-top|right|bottom|left`）。
 * `font` / `background` / `flex` 这些的简写规则复杂到拆不准，
 * **强行拆比不拆更危险**——所以留在"已知误报"里，见文件头说明。
 */
const BORDER_STYLES = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);
const BORDER_WIDTHS = new Set(["thin", "medium", "thick"]);

function expandShorthand(prop, value, out) {
  const m = /^border(?:-(top|right|bottom|left))?$/.exec(prop);
  if (!m) return false;
  const suffix = m[1] ? `-${m[1]}` : "";
  let width = "", style = "", color = "";
  for (const token of value.split(/\s+/).filter(Boolean)) {
    if (BORDER_STYLES.has(token)) style = token;
    else if (BORDER_WIDTHS.has(token) || /^[\d.]+/.test(token)) width = token;
    else color = token;
  }
  // 拆不出三段的（如 `border: none`）按 CSS 规则补默认值，别丢信息
  out[`border${suffix}-width`] = width || "medium";
  out[`border${suffix}-style`] = style || "none";
  out[`border${suffix}-color`] = color || "currentcolor";
  delete out[prop];
  return true;
}

/** `:root` 里的变量表（一层） */function rootVars(css) {
  const vars = {};
  for (const r of topLevelRules(css)) {
    if (!r.sel.split(",").map((s) => s.trim()).includes(":root")) continue;
    for (const part of r.decl.split(";")) {
      const idx = part.indexOf(":");
      if (idx < 0) continue;
      const name = part.slice(0, idx).trim();
      if (name.startsWith("--")) vars[name] = part.slice(idx + 1).trim();
    }
  }
  return vars;
}

/**
 * 把某选择器的声明按文档顺序合并成一个计算值表。
 * `extraSel` 用于 hover：传 `:hover` 会把 `.x` 与 `.x:hover` 一起合并（后者更晚则胜）。
 */
function compute(css, extraSel = null) {
  const out = {};
  for (const r of topLevelRules(css)) {
    const sels = r.sel.split(",").map((s) => s.trim());
    // 命中条件：选择器组里**精确包含**目标（不做后代选择器匹配——见文件头说明）
    const hit = wanted.some((w) => sels.includes(extraSel ? `${w}${extraSel}` : w));
    if (!hit) continue;
    for (const part of r.decl.split(";")) {
      const idx = part.indexOf(":");
      if (idx < 0) continue;
      const prop = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (!prop || !val) continue;
      // CSS 的 `border` 简写覆盖 `border-color` 而不管谁先谁后（层叠在声明层，不在属性层）。
      // 这里按同样的语义处理：写简写时把已存的对应长写清掉，再拆进长写。
      const side = /^border-(top|right|bottom|left)$/.exec(prop);
      if (side) {
        for (const suffix of ["", `-${side[1]}`]) {
          delete out[`border${suffix}-color`];
          delete out[`border${suffix}-width`];
          delete out[`border${suffix}-style`];
        }
      } else if (prop === "border") {
        for (const suffix of ["", "-top", "-right", "-bottom", "-left"]) {
          delete out[`border${suffix}-color`];
          delete out[`border${suffix}-width`];
          delete out[`border${suffix}-style`];
        }
      }
      out[prop] = val;
      expandShorthand(prop, val, out);
    }
  }
  return out;
}

function resolve(value, vars) {
  if (!value || !value.includes("var(")) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) => {
    return vars[name] ?? (fallback ? fallback.trim() : `var(${name})`);
  });
}

function compare(label, b, a, varsB, varsA) {
  const props = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  let diffs = 0;
  console.log(`\n${label}`);
  for (const p of props) {
    // 展开后 `border` 本身已被拆成长写，这里不再显示它
    if (/^border(?:-(?:top|right|bottom|left))?$/.test(p)) continue;
    const x = resolve(b[p], varsB) ?? "（未设置）";
    const y = resolve(a[p], varsA) ?? "（未设置）";
    // 变量未展开时占位符不同，跳过——展开后这个分支不会走到
    if (x.includes("var(") && y.includes("var(") && x !== y) {
      console.log(`  ·  ${p.padEnd(20)} 两边都是变量，跳过（加 --resolve-vars 才比）`);
      continue;
    }
    const ok = x === y;
    if (!ok) diffs++;
    console.log(`  ${ok ? "✓" : "✗"}  ${p.padEnd(20)} ${ref}=${x}   工作区=${y}`);
  }
  return diffs;
}

const varsB = rootVars(before);
const varsA = rootVars(after);

let diffs = 0;
console.log(`选择器：${wanted.join(" , ")}`);
console.log(`基线：${ref}:${file}`);
// 变量没解析出来时**说出来**——它会静默漏报（见 topLevelRules 的说明），
// 而"漏报"比"误报"危险：误报会被人骂着修，漏报会被当成"没问题"。
if (resolveVars) {
  const known = new Set([...Object.keys(varsB), ...Object.keys(varsA)]);
  console.log(`已解析变量：${ref}=${Object.keys(varsB).length} 条，工作区=${Object.keys(varsA).length} 条`);
  if (known.size === 0) {
    console.error("⚠️  一条 CSS 变量都没解析到——--resolve-vars 不会生效，比对结果不可信。");
    process.exit(2);
  }
}
diffs += compare("常态", compute(before), compute(after), varsB, varsA);
diffs += compare(":hover", compute(before, ":hover"), compute(after, ":hover"), varsB, varsA);

if (diffs === 0) {
  console.log(`\n结论：计算值逐属性相同 ✓${resolveVars ? "（变量已展开）" : "（变量未展开，变量位置跳过——建议加 --resolve-vars）"}`);
  process.exit(0);
}
console.log(`\n结论：${diffs} 处差异 ✗ —— 逐条确认是不是有意的。`);
process.exit(1);
