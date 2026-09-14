/**
 * 按需替身：`node --test` 里把**指名的编排函数**换成脚本化返回值。
 *
 * ## 它解决什么问题
 *
 * 两个 POST 路由（`from-url` / `from-screenshot`）的**非 401 分支**此前一条都测不了：
 * 编排函数是模块级 import，而 `mock.module()` 要 `--experimental-test-module-mocks`
 * 即改 `npm test` 脚本（本批红线）。于是 422/502 这些分支只有结构契约、没有真实断言。
 *
 * ## 机制（为什么是数据表，不是回调）
 *
 * `tests/alias-loader.mjs` 用**子路径别名重定向**把 `@/lib/template-from-url`
 * 指到 `tests/substitutes/template-from-url.ts`，那个文件对要换的导出调用
 * `fakeOr("createTemplateFromUrl")` 从**本模块的环境变量**取返回值。
 *
 * ⚠️ **脚本表只装数据，不装函数**——这不是风格问题，是隔离要求：
 * 测试若传一个真实实现（哪怕只是 `structuredClone`）进来，替身模块就会 import
 * 真实模块，而真实模块在导入期会拉进存储层、固化数据目录（`lib/site-store.ts:89`
 * 的模块级常量）——替身的副作用就**溢出到测试进程之外**了，正好违反
 * "替身作用域仅限激活它的单个测试文件"。数据表让替身模块保持**零真模块 import**。
 *
 * ⚠️ **为什么走环境变量而不是 `register({ data })`**：实测 `register` 的第二参
 * 在**解析钩子线程里读不到**（钩子线程有自己的全局对象）；而 `process.env`
 * 本进程共享、钩子线程能看见。"作用域仅限单个测试文件"靠的是
 * `node --test` **每个文件独立进程**（实测 PID 各异），env 不会串台。
 *
 * ## 用法
 *
 * ```ts
 * import { armSubstitutions } from "../lib/testing/substitution.ts";
 * // 必须在 import 被测路由**之前**（ESM 静态 import 会先求值）
 * armSubstitutions({ "@/lib/template-from-url": { createTemplateFromUrl: { ok: false, … } } });
 * ```
 *
 * ## 防"配了没生效"（本项目栽过的假绿）
 *
 * 替身**没配**时若静默返回 undefined，路由会以 `TypeError` 崩，看起来像环境问题；
 * 替身**配了但拼错键**时同理。所以"查无此名"直接**抛错并列出可用键**——
 * 宁可红得难看，也不给一个说不清的死法。
 */

/** 替身表的载体：一个进程级环境变量。 */
export const SUBSTITUTION_ENV = "SITECRAFT_TEST_SUBSTITUTIONS";

/** 替身表：`别名 → { 导出名 → 脚本化返回值 }`。**值只允许数据**（见文件头）。 */
export type SubstitutionScript = Record<string, Record<string, unknown>>;

/**
 * 写替身表。必须在 `import` 被测路由**之前**调用。
 *
 * 每个用例都可以再调一次来换返回値——`fakeOr` 是**每次调用时**读表的，
 * 所以同一个替身模块能在不同用例里给出不同结果。
 */
export function armSubstitutions(script: SubstitutionScript): SubstitutionScript {
  // 值必须是可 JSON 序列化的纯数据——函数会静默变成 undefined，
  // 那正是"配了没生效"，所以这里当场报
  for (const [alias, table] of Object.entries(script)) {
    for (const [name, value] of Object.entries(table)) {
      if (typeof value === "function") {
        throw new Error(`[substitution] ${alias}.${name} 是函数。替身表只收数据——见本文件头「为什么是数据表」。`);
      }
    }
  }
  process.env[SUBSTITUTION_ENV] = JSON.stringify(script);
  return script;
}

/** 读当前替身表（loader 与 `fakeOr` 共用同一份解析逻辑）。 */
export function currentSubstitutions(): SubstitutionScript | null {
  const raw = process.env[SUBSTITUTION_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 不静默：解析不了要看得见，否则就是又一次"配了没生效"
    console.error(`[substitution] ${SUBSTITUTION_ENV} 不是合法 JSON——替身全部未生效`);
    return null;
  }
}

/**
 * 替身模块调用它取脚本值。
 *
 * `name` 用**源模块里的导出名**，测试只提供要换的那几个。
 *
 * ⚠️ **只在"调用方所在的那个模块的表"里找**，不是遍历所有表。
 * 早期版本遍历了所有内层表（谁有这个名字就返回谁），后果是：
 * 测试把 `createTemplateFromUrl` 误写进 `@/lib/template-from-screenshot`
 * 那一格时，**照样取到值**——于是"替身作用域"这层约束被绕过了，
 * 而且错得毫无提示。所以这里要 `alias`，找不到就抛。
 *
 * @param alias 本替身文件对应的源模块别名（如 `@/lib/template-from-url`）
 * @param name  该模块里的导出名
 */
export function fakeOr(alias: string, name: string): unknown {
  const table = currentSubstitutions();
  if (!table) {
    throw new Error(
      `[substitution] 替身被激活了但替身表是空的。请在本文件顶部、import 路由之前调用 armSubstitutions(...)。`,
    );
  }
  const entries = table[alias];
  if (!entries || typeof entries !== "object") {
    throw new Error(
      `[substitution] 替身表里没有 ${alias} 这一格（现有：${Object.keys(table).join("、") || "（空）"}）。` +
        `表里缺这一格说明替身根本没配到这个模块上——静默返回 undefined 只会让路由以 TypeError 崩。`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(entries, name)) {
    throw new Error(
      `[substitution] ${alias} 的替身表里没有 ${name}（可用：${Object.keys(entries).join("、") || "（空）"}）。` +
        `键名拼错会让替身退化成"没生效"，所以这里直接抛。`,
    );
  }
  // 取副本：调用方改它不该污染替身表（否则用例之间会互相串）
  return structuredClone(entries[name]);
}

/** 清掉替身表——测试收尾用。 */
export function disarmSubstitutions() {
  delete process.env[SUBSTITUTION_ENV];
}
