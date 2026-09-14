import assert from "node:assert/strict";
import test from "node:test";
import { navigationViewSnippet } from "../lib/template-adapters/navigation-view.ts";
import { defaultDraft } from "../lib/site-document.ts";

/**
 * 导航兼容视图（⑥ 数组化）的契约测试。
 *
 * ## 背景
 *
 * `navigation` 从「固定 5 键对象」改成数组后，**21 个适配器**仍然按
 * `draft.navigation.about` 这种键索引读它。那些适配器是注入 iframe 的源码字符串，
 * 逐个改写风险大，所以给它们一个按 id 索引的 Proxy 视图。
 *
 * ## 这组测试为什么必须读**真实片段**
 *
 * 注入 iframe 的脚本出错是**静默的**——父窗口只看到"页面没变"，
 * 拿不到任何报错。所以不能在这边重写一份等价实现来测（两份会漂），
 * 必须把**真正会注入的那段源码**跑起来。
 */

/** 把注入片段当脚本求值，拿到它导出的两个函数。 */
async function loadSnippet() {
  const source = navigationViewSnippet();
  // 注入片段不含模块语法，用 Function 求值即可（与浏览器里 `new Function` 同构）
  const factory = new Function(`${source}; return { makeNavigationView, makeNavigationLookup };`);
  return factory() as {
    makeNavigationView: (items: unknown) => Record<string, { zh?: string; en?: string } | undefined>;
    makeNavigationLookup: (items: unknown) => (id: string) => { id: string; target: string } | undefined;
  };
}

test("真实注入片段能作为脚本求值（语法错会在浏览器里静默失效）", async () => {
  const { makeNavigationView } = await loadSnippet();
  assert.equal(typeof makeNavigationView, "function");
});

test("适配器的既有写法（按 id 取键）继续工作", async () => {
  const { makeNavigationView } = await loadSnippet();
  const nav = makeNavigationView(defaultDraft.navigation);
  assert.equal(nav.about?.zh, "关于");
  assert.equal(nav["features"]?.en, "Advantages");
  assert.equal(nav.contact?.zh, "联系");
});

test("**下标索引返回 undefined**——数组化后 `nav[0]` 是错的，不能放行", async () => {
  // 转成对象的话 `nav[0]` 会拿到第 0 项：看着对，其实是巧合。
  // 挡成 undefined 的后果是"该处回退到兜底文案"——看得见、可定位。
  const { makeNavigationView } = await loadSnippet();
  const nav = makeNavigationView(defaultDraft.navigation);
  assert.equal(nav[0], undefined);
  assert.equal(nav["1"], undefined);
});

test("**把槽位路径当字段名也返回 undefined**（yukina 那个一直没生效的写法）", async () => {
  // 实测：`yukina.ts` 写的是 `draft?.navigation?.home?.zh`，等效于查字段名 `home.zh`，
  // 而那个键从来就不存在 —— "首页"一直是兜底文案。这里把它钉住：
  // 这类写法**不会**因为数组化而突然"歪打正着"，但也不能被当成正确。
  const { makeNavigationView } = await loadSnippet();
  const nav = makeNavigationView(defaultDraft.navigation);
  assert.equal(nav["home.zh"], undefined);
  assert.equal(nav["about.zh"], undefined);
});

test("`in` 与 `Object.keys` 与真实对象一致（适配器会用来判存在）", async () => {
  const { makeNavigationView } = await loadSnippet();
  const nav = makeNavigationView(defaultDraft.navigation);
  assert.equal("about" in nav, true);
  assert.equal("pricing" in nav, false);
  assert.deepEqual(Object.keys(nav), ["about", "features", "services", "products", "contact"]);
});

test("空数组 / 脏数据不抛异常（生成过程中草稿可能是半成品）", async () => {
  const { makeNavigationView } = await loadSnippet();
  for (const bad of [[], null, undefined, "about", [{ id: "x" }, { label: {} }, null]]) {
    const nav = makeNavigationView(bad);
    assert.equal(nav.about, undefined);
  }
});

test("`makeNavigationLookup` 给得到 target——这才是有序导航要的东西", async () => {
  // `nav[id]` 只给 label，拿不到跳转目标。数组化的全部意义是
  // "指向哪里由数据决定"，所以新代码用 lookup。
  const { makeNavigationLookup } = await loadSnippet();
  const lookup = makeNavigationLookup(defaultDraft.navigation);
  assert.equal(lookup("about")?.target, "#about");
  assert.equal(lookup("nope"), undefined);
});

test("注入片段里不含反引号与 import——它会进一个模板字面量再进 iframe", async () => {
  // 这段源码先被 `${...}` 塞进 route 的模板字面量，再作为脚本注入 iframe。
  // 里面只要有一个未转义的反引号，**整个 route 文件就编译不过**（已踩过三次）。
  const source = navigationViewSnippet();
  assert.equal(source.includes(String.fromCharCode(96)), false, "注入片段里不能有反引号");
  assert.equal(/^\s*import\s/m.test(source), false, "注入片段里不能有 import");
  assert.ok(source.includes("function makeNavigationView("), "注入片段缺了核心函数——而空片段是静默失效");
});
