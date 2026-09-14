/**
 * 导航兼容视图（2026-09-11，⑥ 数组化）。
 *
 * ## 它解决什么
 *
 * `navigation` 从「固定 5 键对象」改成了数组。但 **21 个模板适配器**
 * 全都按 `draft.navigation.about` / `draft.navigation[key]` 这种**键索引**读它——
 * 那些 adapter 是在 iframe 里跑的源码字符串，逐个改写风险大、收益小。
 *
 * 所以这里给它们一个**按 key 索引仍能工作的视图**：数组 → Proxy，
 * 按 key 查得到那一项的 `label`，查不到给 `undefined`（适配器自己本来就有 `|| 兜底`）。
 *
 * ## 为什么用 Proxy 而不是把数组转回对象
 *
 * 转回对象看起来更简单，但**悄悄放行两种真 bug**：
 *
 *  | 写法 | 转成对象后 | Proxy |
 *  |---|---|---|
 *  | `nav[0]`（下标索引） | 拿到第 0 项，**看着对**，其实是巧合 | `undefined` |
 *  | `nav['about.zh']`（把槽位路径当字段名） | `undefined` | `undefined` |
 *
 * 第二行是**已经在代码里的事实**：`yukina.ts` 写的是 `draft?.navigation?.home?.zh`——
 * 等效于查字段名 `home.zh`，而那个键**从来就不存在**，所以"首页"一直是兜底文案。
 * 对象和 Proxy 都返回 `undefined`，但 Proxy 至少**不会把新的同类错误伪装成正确**。
 * （要真正修好，是让适配器改用 `localize(nav.home)`——那是下一轮的事，见文件末尾。）
 *
 * ## 为什么写成 `.mjs` 而不是 `.ts`
 *
 * 两边都要用它，而两边读它的方式不同：
 *  - **服务端**（质量门/装载器）要能 `import` 它；
 *  - **浏览器**（注入 iframe 的 bridge 脚本）只能拿一段**源码字符串**，
 *    而那整段脚本本身是 route 里的一个模板字面量，运行时不经过打包器。
 *
 * `.mjs` + 构建期读文件，两边拿到的是**同一份字节**——不会漂。
 * （与 22 个适配器的 `prepareFn` 是同一套做法：注入的是源码文本。）
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SNIPPET_PATH = path.join(process.cwd(), "lib", "template-adapters", "navigation-view.mjs");

/**
 * 这个 snippet 里**必须存在**的函数名。
 *
 * 读源码注入最怕"文件改了、片段没了"，此时注入的是一段**语法错误或空**的脚本——
 * 而 iframe 里报错是**静默的**（父窗口只看到页面没变），排查极难。
 * 所以注入前先断言。
 */
const REQUIRED_MARKER = "function makeNavigationView(";

let cached: string | null = null;

/** 取注入 iframe 用的源码。**带进程内缓存**——每次预览都读盘没有必要。 */
export function navigationViewSnippet(): string {
  if (cached !== null) return cached;
  let source: string;
  try {
    source = readFileSync(SNIPPET_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `读不到导航兼容视图 ${SNIPPET_PATH}：${error instanceof Error ? error.message : String(error)}。` +
        "它在预览/工作台的注入脚本里被内联，缺了会导致 iframe 脚本语法错误。",
    );
  }
  // 只去掉注释与 import 行——保留其余源码原样（注入的是一段脚本，不是模块）
  const body = source
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  if (!body.includes(REQUIRED_MARKER)) {
    throw new Error(
      `${SNIPPET_PATH} 里找不到 \`${REQUIRED_MARKER}\`——函数被改名或删掉了，` +
        "而注入空片段是**静默失效**（iframe 报错不会传回父窗口）。",
    );
  }
  cached = body;
  return cached;
}
