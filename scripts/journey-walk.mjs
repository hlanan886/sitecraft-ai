import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "http://localhost:3000";
const SHARED = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = [];
const step = (n, msg) => { log.push(`[${n}] ${msg}`); console.log(`[${n}] ${msg}`); };

// 旅程用一句真实的工厂客户话
const SENTENCE = "我们做光伏组件出口，主要卖给欧洲的安装商，想要一个能收询盘的官网";

step(1, "打开 /generate");
await page.goto(BASE + "/generate", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

step(2, "填入一句话并提交");
await page.fill("textarea", SENTENCE);
await page.click("text=开始理解需求");

// 可能追问，也可能直接出结果——两种都要处理
let state = "unknown";
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-template-card]").length,
    asking: /还差几个关键信息|继续理解/.test(document.body.innerText),
    err: document.querySelector("[role=alert]")?.textContent?.trim()?.slice(0, 80) ?? "",
  }));
  if (s.err) { state = "error:" + s.err; break; }
  if (s.cards > 0) { state = "cards"; break; }
  if (s.asking && i > 3) { state = "asked"; break; }
}
step(3, "结果: " + state);
await page.screenshot({ path: ".shots/j1-step1.png" });

if (state === "asked") {
  step(4, "AI 追问了，按真人方式回答");
  const inputs = await page.$$("input[type=text], input:not([type])");
  const answers = ["华曜新能源科技", "A 专业可靠", "中英文都要"];
  for (let i = 0; i < Math.min(inputs.length, answers.length); i++) {
    await inputs[i].fill(answers[i]).catch(() => {});
  }
  await page.click("text=继续理解");
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => document.querySelectorAll("[data-template-card]").length);
    if (n > 0) { state = "cards"; break; }
  }
  step(5, "回答后: " + state);
  await page.screenshot({ path: ".shots/j2-clarified.png" });
}

if (state.startsWith("cards")) {
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-template-card]")].map(c => c.getAttribute("data-template-card"));
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    return { cards, summary: t.match(/我理解你要的是[^。]{0,120}/)?.[0] ?? "", industry: t.match(/行业[^\s]{0,30}/)?.[0] ?? "" };
  });
  step(6, "推荐模板: " + JSON.stringify(info.cards));
  step(7, "AI 理解: " + info.summary);

  // ④ 选模板：点第一张卡（模拟真人挑一个）
  const picked = info.cards[0];
  step(8, "点选模板卡: " + picked);
  await page.click(`[data-template-card="${picked}"]`);
  await page.waitForTimeout(2500);
  const sel = await page.getAttribute("[data-template-selection]", "data-template-selection");
  step(9, "当前选中: " + sel + (sel === picked ? " ✅" : " ❌ 与点击不一致"));
  await page.screenshot({ path: ".shots/j3-picked.png", fullPage: false });

  // ⑤ 生成
  step(10, "点「用此模板生成站点内容」");
  await page.click("text=用此模板生成站点内容");

  let gen = "timeout";
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({
      done: /当前结果已保存/.test(document.body.innerText),
      entering: [...document.querySelectorAll("button")].some((b) => /进入工作台/.test(b.textContent || "")),
      err: document.querySelector("[role=alert]")?.textContent?.trim()?.slice(0, 120) ?? "",
      eyebrow: document.querySelector(".generate-progress-view .eyebrow")?.textContent?.trim() ?? "",
    }));
    if (s.err) { gen = "error:" + s.err; break; }
    if (s.done || s.entering) { gen = "done"; break; }
    if (i % 20 === 19) step(10, `  …生成中 ${i + 1}s：${s.eyebrow}`);
  }
  step(11, "生成结果: " + gen);
  await page.screenshot({ path: ".shots/j4-generated.png" });

  if (gen === "done") {
    step(12, "点「进入工作台」");
    await page.click("text=进入工作台");
    await page.waitForTimeout(6000);
    const ws = await page.evaluate(async () => {
      const siteId = new URLSearchParams(location.search).get("siteId");
      const draft = await (await fetch(`/api/sites/${siteId}/draft`)).json();
      return {
        siteId,
        url: location.href,
        // 工作台究竟报了哪些「未完成」
        notices: [...document.querySelectorAll(".tip, [class*=notice], [class*=alert]")].map((n) => (n.textContent || "").trim().slice(0, 90)).filter(Boolean).slice(0, 8),
        draftState: {
          companyName: draft.draft?.companyName ?? draft.companyName,
          products: (draft.draft?.products ?? draft.products)?.length ?? "?",
          hidden: JSON.stringify(draft.draft?.hiddenSections ?? draft.hiddenSections),
        },
      };
    });
    step(13, "工作台: " + ws.url);
    step(14, "草稿: " + JSON.stringify(ws.draftState));
    step(15, "工作台提示: " + JSON.stringify(ws.notices));
    await page.screenshot({ path: ".shots/j5-workspace.png" });
    SHARED.siteId = ws.siteId;

    // ===== ⑦ 发布 =====
    step(16, "点「发布」");
    await page.click("button:has-text('发布'):not(:has-text('暂不'))");
    await page.waitForTimeout(4000);

    // 可能弹「事实声明确认」——真人是勾选后确认，这里照做
    const needsFactConfirm = await page.evaluate(() =>
      /发布前需确认以下事实声明/.test(document.body.innerText));
    if (needsFactConfirm) {
      step(17, "出现事实确认面板，勾选「我已核对」后确认发布");
      await page.click("input[type=checkbox]");
      await page.waitForTimeout(500);
      await page.click("text=确认并发布");
      await page.waitForTimeout(4000);
    } else {
      step(17, "无需事实确认");
    }

    const pub = await page.evaluate(() => {
      const t = (document.body.innerText || "").replace(/\s+/g, " ");
      return {
        published: /已发布版本/.test(t),
        version: t.match(/已发布版本 v(\d+)/)?.[1] ?? "",
        blocked: /发布前仍有内容需要人工确认|当前内容还不能发布/.test(t),
        blockedDetail: t.match(/待处理：([^。]{0,120})/)?.[1] ?? "",
        warn: t.match(/待确认：([^。]{0,120})/)?.[1] ?? "",
      };
    });
    step(18, "发布结果: " + JSON.stringify(pub));
    await page.screenshot({ path: ".shots/j6-published.png" });

    if (pub.published) {
      SHARED.published = true;

      // ===== ⑧ 手机打开那个网址（模拟真实访客）=====
      step(19, "手机尺寸打开公开页");
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        isMobile: true,
        hasTouch: true,
      });
      const visitor = await phone.newPage();
      const publicUrl = `${BASE}/published/${SHARED.siteId}`;
      const resp = await visitor.goto(publicUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await visitor.waitForTimeout(9000);
      // 公开页正文是 iframe（真实模板渲染），必须滚到底逼出懒加载内容
      for (let i = 0; i < 12; i++) { await visitor.mouse.wheel(0, 900); await visitor.waitForTimeout(350); }
      await visitor.waitForTimeout(2500);

      /**
       * ⚠️ 表单在 **iframe 内部**，不在顶层文档。
       *
       * 2026-09-12 实测踩到：早先这步只查 `document.querySelectorAll`（顶层），
       * 于是"表单数 0"被误报成产品缺陷——而真实模板的正文整个在一个 iframe 里
       * （`/api/templates/<id>/preview`）。**测量口径错会造出假 bug**，比不测更糟。
       * 现在下钻到 iframe 里查。
       */
      const frame = visitor.frames().find((f) => f !== visitor.mainFrame());
      step(20, `公开页 HTTP ${resp?.status()} · 框架数 ${visitor.frames().length - 1}（0 表示正文没在 iframe 里）`);

      const pageState = frame ? await frame.evaluate(() => {
        const t = (document.body.innerText || "").replace(/\s+/g, " ");
        const inputs = [...document.querySelectorAll("input, textarea")].map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || "",
          name: el.getAttribute("name") || "",
          placeholder: el.getAttribute("placeholder") || "",
        })).filter((el) => el.type !== "hidden" && el.type !== "checkbox");
        return {
          hasContent: t.length > 200,
          head: t.slice(0, 160),
          formCount: document.querySelectorAll("form").length,
          leadForm: !!document.querySelector("[data-sitecraft-lead-form]"),
          inputs,
          submitText: [...document.querySelectorAll("button, input[type=submit]")].map((b) => (b.textContent || b.value || "").trim()).filter(Boolean).slice(0, 8),
          hasPlaceholderCompany: /（占位）/.test(t),
          visibleToBeFilled: (t.match(/待补充/g) || []).length,
        };
      }) : { hasContent: false, head: "", formCount: 0, leadForm: false, inputs: [], submitText: [], hasPlaceholderCompany: false, visibleToBeFilled: 0 };

      step(21, "首屏文字: " + pageState.head);
      step(22, `表单数: ${pageState.formCount} · 询盘表单: ${pageState.leadForm ? "✅ 已注入" : "❌ 未注入"} · 输入框 ${pageState.inputs.length} 个`);
      step(23, "输入框: " + JSON.stringify(pageState.inputs));
      if (pageState.hasPlaceholderCompany) step(23, "⚠️ 页面上出现了「（占位）」——占位名泄漏到成品站");
      await visitor.screenshot({ path: ".shots/j7-phone-public.png" });

      // ===== ⑨ 填询盘表单 =====
      if (frame && pageState.inputs.length > 0) {
        step(24, "访客填写询盘表单并提交");
        const filled = await frame.evaluate(() => {
          const setValue = (el, value) => {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const known = {
            name: "Lars Andersen",
            email: "buyer@nordic-solar.example",
            company: "Nordic Solar AS",
            message: "需要 500 块 550W 组件，2026 年 Q1 交付，请报 CIF 鹿特丹价。",
          };
          let n = 0;
          for (const el of document.querySelectorAll("form input, form textarea")) {
            const key = (el.getAttribute("name") || "").toLowerCase();
            if (!key || key === "website") continue; // website 是蜜罐，真人不会填
            if (known[key] !== undefined) { setValue(el, known[key]); n += 1; }
          }
          return n;
        });
        step(25, `已填 ${filled} 个字段`);
        await visitor.screenshot({ path: ".shots/j8-form-filled.png" });

        const submitted = await frame.evaluate(() => {
          const form = document.querySelector("form[data-sitecraft-lead-form]") || document.querySelector("form");
          const btn = form?.querySelector("button[type=submit], input[type=submit], button");
          if (!btn) return false;
          btn.click();
          return true;
        });
        step(26, "点提交: " + submitted);
        await visitor.waitForTimeout(6000);
        const after = await frame.evaluate(() => {
          const t = (document.body.innerText || "").replace(/\s+/g, " ");
          const status = document.querySelector("[data-sitecraft-lead-status], [role=status]");
          return { ok: /提交成功|已收到|感谢|我们会尽快|谢谢|Thank/i.test(t), status: (status?.textContent || "").trim().slice(0, 120), tail: t.slice(-160) };
        });
        step(27, "提交反馈: " + JSON.stringify(after));
        await visitor.screenshot({ path: ".shots/j9-lead-submitted.png" });
        SHARED.leadSubmitted = after.ok;
      } else {
        step(24, "❌ 公开页上没有找到任何表单/输入框——访客填不了询盘");
      }
      await phone.close();

      // ===== ⑩ 回后台看那条询盘 =====
      // 站主视角：这条询盘有没有真的进到他的列表里（端到端的最后一环）。
      // 直接在页面里查，而不是绕过 UI 打 API——要验的是**站主能不能看到**。
      step(28, "回后台查这条询盘");
      const leadsPage = await page.goto(`${BASE}/leads?siteKey=${encodeURIComponent(SHARED.siteId)}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const leadBoard = await page.evaluate(async () => {
        const t = (document.body.innerText || "").replace(/\s+/g, " ");
        const siteId = new URLSearchParams(location.search).get("siteKey");
        const api = await (await fetch(`/api/leads?siteKey=${encodeURIComponent(siteId)}`)).json().catch(() => null);
        const first = api?.leads?.[0];
        return {
          http: true,
          // UI 上真的渲染出来了吗
          showsName: /Lars Andersen/.test(t),
          showsCompany: /Nordic Solar AS/.test(t),
          showsMessage: /500 块 550W|CIF/.test(t),
          total: api?.total ?? null,
          newCount: api?.newCount ?? null,
          latest: first ? { name: first.name, status: first.status, source: first.source } : null,
        };
      });
      step(29, `询盘后台 HTTP ${leadsPage?.status()} · 总数 ${leadBoard.total} · 未读 ${leadBoard.newCount}`);
      step(30, `页面渲染：姓名=${leadBoard.showsName} 公司=${leadBoard.showsCompany} 内容=${leadBoard.showsMessage}`);
      step(31, "最新一条: " + JSON.stringify(leadBoard.latest));
      await page.screenshot({ path: ".shots/j10-leads-board.png" });
      SHARED.leadVisibleInBackoffice = Boolean(leadBoard.showsName && leadBoard.total > 0);
    } else if (pub.blocked) {
      step(18, "发布被拦：" + pub.blockedDetail);
    }
  }
}
fs.writeFileSync(".shots/journey-state.json", JSON.stringify(SHARED, null, 1));
await browser.close();
console.log("\n=== 旅程日志 ===\n" + log.join("\n"));
