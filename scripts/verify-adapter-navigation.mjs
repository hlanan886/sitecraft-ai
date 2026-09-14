/**
 * 实测：导航数组化之后，22 个模板适配器还能不能正确渲染导航。
 *
 * ## 为什么要有这个脚本
 *
 * 21 个适配器是**注入 iframe 的源码字符串**，按 `draft.navigation.about` 这种键索引
 * 读导航。数组化改了数据形状，而 iframe 里出错是**静默的**——
 * 父窗口只看到"页面没变"，单测也测不到（它们只读源码文本）。
 *
 * 所以这里开真浏览器：给每个模板喂一份**导航文案明显可辨**的草稿，
 * 读渲染结果里有没有那几句话。
 *
 * ## 两个**已知且与本改动无关**的失败（别去"修"它们）
 *
 *  - **yukina**：适配器读 `navigation?.home`，而 `home` 从来就不在 schema 里
 *    （代码里原文就是 `localizeValue(draft?.navigation?.home)`，
 *    等效于查字段名 `home`，那是 `undefined`）。所以"首页"一项**一直是兜底文案**，
 *    数组化前后**行为逐字未变**。要真修得改适配器（用 `localize(nav.home)` 那种形态）。
 *  - **screwfast**：模板自带脚本抛 `"[data-demo-form]".forEach is not a function`，
 *    整页渲染被它带崩，且该模板**根本没有导航适配**（grep `navigation` 计数为 0）。
 *    同样与数组化无关。
 *
 * 脚本对这两项照常报 FAIL——**如实报告比悄悄豁免好**，
 * 但上面的说明能省掉下一个人的排查。
 *
 * 用法：node scripts/verify-adapter-navigation.mjs [模板id...]
 * 前置：dev server 在 localhost:3000。
 */
import { chromium } from "playwright";

const BASE = process.env.SITECRAFT_BASE || "http://localhost:3000";
const ALL = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["forge", "atlas", "signal", "kindred", "moon", "screwfast", "landwind", "foxi",
     "astro-starter", "lonestone", "fresh", "awesome", "astrogent", "shadcn-landing2",
     "astrofy", "devportfolio", "astropaper", "yukina", "tailwind-landing",
     "shadcn-landing", "nextjs-landing", "powerai"];

/**
 * 喂进去的导航文案**故意与众不同**，这样"渲染出来了"和"回退到模板自带兜底"
 * 一眼可辨——适配器里到处是 `|| '关于我们'` 这种兜底，测不出来就等于没测。
 */
const NAV = [
  { id: "about",    label: { zh: "导航甲关于", en: "NAV-A" },  target: "#about" },
  { id: "features", label: { zh: "导航乙优势", en: "NAV-B" },  target: "#features" },
  { id: "services", label: { zh: "导航丙服务", en: "NAV-C" },  target: "#services" },
  { id: "products", label: { zh: "导航丁产品", en: "NAV-D" },  target: "#products" },
  { id: "contact",  label: { zh: "导航戊联系", en: "NAV-E" },  target: "#contact" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const results = [];
for (const id of ALL) {
  const row = { id, ok: false, hit: [], slots: 0, reason: "" };
  try {
    // 每次导航前装监听：bridge 会 postMessage 给自己（顶层页面），
    // 用它的 ready/applied 做同步点，比死等毫秒可靠（模板大小差很多）
    await page.addInitScript(() => {
      window.__scReady = false;
      window.__scApplied = null;
      window.addEventListener("message", (e) => {
        if (e.data?.type === "sitecraft:ready") window.__scReady = true;
        if (e.data?.type === "sitecraft:applied") window.__scApplied = e.data;
      });
    });
    await page.goto(`${BASE}/api/templates/${id}/preview`, { waitUntil: "domcontentloaded", timeout: 20000 });
    // 等 bridge 就绪：适配器只在收到 sitecraft:content 后才跑
    await page.waitForFunction(() => window.__scReady === true, { timeout: 20000 });
    await page.evaluate(({ nav, templateId }) => {
      const draft = {
        schemaVersion: 2, siteName: "导航验证站", companyName: "导航验证站", templateId: "x",
        locale: "zh", revision: 1, lastChange: "verify", industry: "制造业", goal: "验证导航",
        siteModel: "corporate", navigation: nav,
        content: {
          hero: { title: { zh: "验证首屏", en: "H" }, subtitle: { zh: "副文", en: "S" }, cta: { zh: "按钮", en: "C" } },
          about: { title: { zh: "关于", en: "A" }, body: { zh: "正文", en: "B" } },
          features: { title: { zh: "优势", en: "F" }, intro: { zh: "", en: "" }, items: [] },
          services: { title: { zh: "服务", en: "S" }, intro: { zh: "", en: "" }, items: [] },
          products: { title: { zh: "产品", en: "P" }, intro: { zh: "", en: "" } },
          contact: { title: { zh: "联系", en: "C" }, body: { zh: "", en: "" }, email: "", phone: "", address: { zh: "", en: "" } },
        },
        sectionOrder: ["about", "features", "services", "products", "contact"],
        hiddenSections: [], designTokens: null, assets: {}, products: [], logos: [],
      };
      window.__scSendContent = () => window.postMessage({ type: "sitecraft:content", templateId, siteKey: "verify", draft, locale: "zh", expectedTargets: [], variant: "preview", editMode: "ai" }, "*");
      window.__scSendContent();
    }, { nav: NAV, templateId: id });
    /**
     * **重发三次**，不做条件判断。
     *
     * 真实父窗口在收到 `sitecraft:ready` 后会补发一次 content
     * （见 open-source-template-frame.tsx 的 ready 分支），因为 bridge 的监听器
     * 可能比消息晚挂上。第一版只发一次就等，于是 powerai / shadcn-landing2
     * 偶发收不到——**时序造成的假失败**，会让人去改本来就对的代码。
     *
     * 无条件重发而不是"没收到再发"：`applied` 是异步的，
     * 用它当门会让第一次的迟到报告把后续重发全挡掉。
     */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate(({ nav: _, templateId }) => {
        const send = window.__scSendContent;
        if (typeof send === "function") send();
      }, { nav: NAV, templateId: id });
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(400);
    const applied = await page.evaluate(() => window.__scApplied);

    /**
     * 用 `textContent` 而不是 `innerText`：后者**不返回不可见元素的文字**
     * （`display:none` / `visibility:hidden` 的节点会被跳过），
     * 而适配器常常把导航也写进隐藏的移动端菜单里。
     * 第一版用 innerText，于是 forge 明明五项全渲染了却被判成 1/5——
     * **测量方式造成的假失败**，比不测还糟（会让人去改本来就对的代码）。
     */
    const text = await page.evaluate(() => document.body.textContent || "");
    row.hit = ["甲", "乙", "丙", "丁", "戊"].filter((ch) => text.includes(ch));
    // 至少要把 about/contact 这类主项渲染出来；有些模板原生只有 3 个位置，不苛求全中
    row.ok = row.hit.length >= 2;
    if (!row.ok) row.reason = `导航文案一个都没渲染出来（命中 ${row.hit.length} 个，导航槽 ${row.slots} 个）`;
  } catch (error) {
    row.reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
  results.push(row);
  console.log(`${row.ok ? "  ok  " : " FAIL "} ${row.id.padEnd(18)} 文案 ${row.hit.length}/5 [${row.hit.join("")}]  导航槽 ${row.slots}${row.reason ? "  ← " + row.reason : ""}`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 个模板的导航渲染出了我们喂进去的文案`);
if (failed.length) console.log("未通过:", failed.map((r) => r.id).join(", "));
process.exit(failed.length ? 1 : 0);
