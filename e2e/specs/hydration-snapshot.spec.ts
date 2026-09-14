/**
 * T-14 水合快照**负向验证门禁**（2026-09-14）。
 *
 * ## 它守的是什么
 *
 * `shadcn-landing2` 这类 Next.js 导出站的白屏机制（**已实测查清**）：
 *
 * 1. 服务器发出含内容的 HTML（273KB）→ **内容进了 DOM**；
 * 2. 内联 flight payload 脚本**被 CSP 拦**（实测 7 条违规）→ React 拿不到数据；
 * 3. React 水合后**清空容器、渲染成空** → body 里只剩 8 个 `<script>` + 1 个 `<style>`。
 *
 * 修法是**水合快照**：桥接脚本在模板脚本跑完后把 DOM 序列化下来，
 * 之后若被清空，**原样还原**。**内容就不会消失。**
 *
 * ## 为什么必须有这条门禁
 *
 * 那个白屏是**间歇的**（实测 3/50 ≈ 6%）。删掉快照代码**大概率不会**让
 * 任何一次 e2e 跑红——**静默回归**。所以这里用 DOM 手术**确定性地**
 * 制造出"容器被清空"的状态，看快照能否救回来。
 *
 * ⚠️ **这是"删子树"型坏样本**（附则 A4）：只断言容器存在不算数，
 * 必须真的把内容清掉、断言内容能回来。
 *
 * ## 判据
 *
 * - **有快照**：人为清空 `<main>`（`MutationObserver` 会立刻回填）→ 内容回来 → 绿；
 * - **无快照**（把快照代码删掉）：清空后无人回填 → 内容仍在空状态 → **红**。
 *
 * 第二句就是这个文件存在的理由——**先证明它会红**。
 */
import { test, expect, chromium } from "@playwright/test";

/**
 * 桥内的测试钩子（仅当 URL 带 `__sitecraftSnapshotProbe=1` 时出现）。
 * 声明在此而非全局：它**不是对外接口**，只是门禁读内部状态的通道。
 */
declare global {
  interface Window {
    __sitecraftSnapshotState: {
      snapshotLen: () => number;
      snapshotContent: () => number;
      lastContent: () => number;
      rewrites: () => number;
      isStable: () => number;
    };
  }
}

/** 生产口径预览页（T-14 白屏就是在这个 URL 上实测到的）。 */
const PREVIEW_PATH = "/api/templates/shadcn-landing2/preview";

test.describe("T-14 · 水合快照", () => {
  test("容器被清空后快照能把内容还原（删子树坏样本）", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}`, { waitUntil: "domcontentloaded" });
      // 给模板脚本与快照足够的时间落定
      await page.waitForTimeout(3000);

      // 前置：正常态必须有内容（否则下面的"还原"没有意义）
      const before = await page.evaluate(() => ({
        text: document.body.innerText.trim().length,
        sections: document.querySelectorAll("section").length,
      }));
      expect(before.text, "前置：正常态必须有内容").toBeGreaterThan(0);
      expect(before.sections, "前置：正常态必须有 section").toBeGreaterThan(0);

      // ── 坏样本：**忠实复现真实白屏态**（白屏机制的第 3 步）──
      // 实测：真实 EMPTY 时 body 里只剩 8 个 <script> + 1 个 <style>，
      // **innerHTML 非空**。所以"清空 main"是不够忠实的——
      // 它会让 innerHTML 变成空串，从而被"有没有内容"的朴素判断放过。
      // 这里按真实剩余物重建。
      const cleared = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        main.replaceChildren(
          document.createElement("script"),
          document.createElement("script"),
          document.createElement("script"),
          document.createElement("style"),
        );
        return {
          text: main.innerText.trim().length,
          contentEls: [...main.querySelectorAll("*")].filter(
            (el) => !["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"].includes(el.tagName),
          ).length,
        };
      });
      expect(cleared.text, "坏样本必须真的把可见文本清掉").toBe(0);
      expect(cleared.contentEls, "坏样本必须真的把内容元素清掉").toBe(0);

      // ── 断言：快照必须在短窗口内还原内容 ──
      // 没有快照时这里会一直等到超时 → 红（这就是门禁的判别力所在）
      await expect
        .poll(() => page.evaluate(() => document.body.innerText.trim().length), {
          timeout: 5_000,
          message:
            "容器被清空后内容没有回来——水合快照缺失或未生效。\n" +
            "这正是 T-14 白屏的形态：DOM 被清空后无人还原。",
        })
        .toBeGreaterThan(0);

      const restored = await page.evaluate(() => ({
        sections: document.querySelectorAll("section").length,
        h1: [...document.querySelectorAll("h1")].filter((el) => el.innerText?.trim()).length,
      }));
      expect(restored.sections, "还原后 section 应恢复").toBeGreaterThan(0);
      expect(restored.h1, "还原后 h1 应恢复").toBeGreaterThan(0);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  test("快照内容与清空前一致（不是只回填了个空壳）", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const before = await page.evaluate(() => document.body.innerText.trim());
      expect(before.length).toBeGreaterThan(0);

      await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        main.replaceChildren(
          document.createElement("script"),
          document.createElement("script"),
          document.createElement("style"),
        );
      });

      await expect
        .poll(() => page.evaluate(() => document.body.innerText.trim().length), { timeout: 5_000 })
        .toBeGreaterThan(0);

      const after = await page.evaluate(() => document.body.innerText.trim());
      // 不要求逐字相等（快照可能保留的是某个时点），但**必须实质相同**：
      // 只回填一个空壳（长度远小于原文）不算修好。
      expect(
        after.length,
        `还原后的文本量应接近原文（前 ${before.length} / 后 ${after.length}）——只回填空壳不算修好`,
      ).toBeGreaterThan(before.length * 0.8);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  /**
   * 第三条（用户裁决 2）：**防修复变新 bug**。
   *
   * 快照还原是个"往回写 DOM"的动作——它最大的风险**不是救不回来，
   * 而是救过头**：把用户/模型的**合法编辑**也一起回滚掉。
   *
   * 所以这条用例专门造那个场景：快照已捕获 → **模拟就地编辑改了内容** →
   * 再触发一次**非清空的局部替换** → 断言**编辑结果还在**。
   *
   * 先跑它对当前实现：若红了，说明触发条件太宽（会误伤编辑），
   * 按"仅当内容元素从 N 塌缩到 ~0 才 restore"收紧后再转绿。
   */
  test("快照不得回滚合法编辑（收紧触发条件）", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const before = await page.evaluate(() => document.body.innerText.trim().length);
      if (before === 0) test.skip(true, "本轮撞上 T-14 白屏态（环境命中），本用例需要正常态起步");

      // ① 模拟就地编辑：改掉首个 h1 的文本
      const EDITED = "SITECRAFT_EDIT_MARKER";
      await page.evaluate((marker) => {
        const h1 = document.querySelector("h1");
        if (h1) h1.textContent = marker;
      }, EDITED);

      // ② 触发一次**非清空的局部替换**（内容元素数没有塌缩到 0）
      await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const first = main.firstElementChild;
        if (first) {
          const swap = document.createElement("div");
          swap.appendChild(document.createTextNode("局部更新"));
          first.replaceChildren(swap);
        }
      });

      // ③ 断言：编辑结果**没有被快照回滚**
      await page.waitForTimeout(2000); // 给快照的兜底窗口足够时间（若它要误伤，早就动了）
      const stillEdited = await page.evaluate(
        (marker) => document.body.innerText.includes(marker),
        EDITED,
      );
      expect(
        stillEdited,
        "就地编辑的结果被快照回滚了——触发条件太宽，会误伤合法编辑。" +
          "收紧方向：仅当「内容元素数从 N 塌缩到 ~0」才 restore。",
      ).toBe(true);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  /**
   * ══ 三把锁（2026-09-14 用户裁决 3）══
   *
   * 新实现有三处机制改动，每处都**必须有一个能红它的场景**（军规 2），
   * 否则机制本身就成了新的无门禁代码。三个场景都靠桥内的
   * `__sitecraftSnapshotProbe=1` 钩子读内部状态——钩子只在异常签名下出现，
   * 正常路径不暴露（见 `lib/template-preview-bridge.ts` 注释）。
   *
   * **每把锁的坏样本与实测原文都记在对应用例的注释里**。
   */

  /** 锁 A · `capture` 只接受**内容更多**的快照。 */
  test("锁A：水合中间态不得用残页覆盖完整快照", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}?__sitecraftSnapshotProbe=1`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3000);

      const before = await page.evaluate(() => window.__sitecraftSnapshotState.snapshotLen());
      expect(before, "前置：正常态必须已采到快照").toBeGreaterThan(0);

      /* ⚠️ 场景设计（两版拍不红，已修）：坏样本必须构造**元素数超过快照、
       * 文字量近乎为零**的残页态——这正是 React 水合中间态的真实形态
       * （大量空壳节点、无业务文本）。
       * 首版只留 1 个元素 → 元素数远低于快照，**任何**守卫都会拒绝，测不到东西；
       * 二版凑够 839 个空 div → 元素数够了，**文字量仍是 0**，遂揭穿
       * 「按元素数比大小」的守卫拦不住它。守卫最终按**文字量**判。 */
      const mid = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const need = window.__sitecraftSnapshotState.snapshotContent() + 5;
        main.replaceChildren(document.createElement("script"), document.createElement("style"));
        for (let i = 0; i < need; i += 1) {
          const d = document.createElement("div");
          d.setAttribute("data-empty-shell", String(i));
          main.appendChild(d);
        }
        const contentEls = [...main.querySelectorAll("*")].filter(
          (el) => !["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE"].includes(el.tagName),
        ).length;
        return { contentEls, bodyText: document.body.innerText.trim().length };
      });
      expect(mid.contentEls, "坏样本：残页内容元素数必须**不低于**快照（否则任何守卫都会拒绝，测不到东西）")
        .toBeGreaterThan(834);
      expect(mid.bodyText, "坏样本：残页必须真的没有业务文本（这才是水合中间态的形态）").toBe(0);

      await page.waitForTimeout(800);
      const after = await page.evaluate(() => window.__sitecraftSnapshotState.snapshotLen());
      expect(
        after,
        "水合中间态把完整快照覆盖成了残页——capture 缺「只接受内容更多」守卫。\n" +
          `（快照长度 ${before} → ${after}；残页内容元素 ${mid.contentEls} 但文字为 0）`,
      ).toBeGreaterThanOrEqual(before);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  /** 锁 B · `rewrites` 上限 3。 */
  test("锁B：反复清空的写入次数必须有上限", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}?__sitecraftSnapshotProbe=1`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3000);

      for (let i = 0; i < 8; i += 1) {
        await page.evaluate(() => {
          const main = document.querySelector("main") ?? document.body;
          main.replaceChildren(
            document.createElement("script"),
            document.createElement("script"),
            document.createElement("style"),
          );
        });
        await page.waitForTimeout(400);
      }

      const state = await page.evaluate(() => ({
        rewrites: window.__sitecraftSnapshotState.rewrites(),
        lastContent: window.__sitecraftSnapshotState.lastContent(),
        snapshotContent: window.__sitecraftSnapshotState.snapshotContent(),
      }));
      expect(
        state.rewrites,
        "rewrites 没有上限——反复清空会无限重写（去掉限位检查即可复现）",
      ).toBeLessThanOrEqual(3);
      expect(
        state.rewrites,
        "8 次清空后必须真的写过（否则本用例什么都没测到）",
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  /**
   * 锁 C · **观察者不得提前收工**（2026-09-14 实测真缺陷的防线）。
   *
   * 背景：首版让观察者在「内容已稳定且快照无损」时 disconnect——看似合理，
   * 实测却致命：真实水合清空发生在 **3.1s**，而内容在 1.5s 就"看起来稳定"，
   * 观察者在那之前退休 → 水合清空时已无人值守。
   *
   * **本用例的坏样本 = 把收工判据改回"稳定即收工"**，
   * 场景 = 让页面**持续有 mutation**（内容元素数一直变）直到水合时刻，
   * 然后清空——提前收工的实现在那一刻已退休，内容回不来。
   */
  test("锁C：观察者不得提前收工（水合前的持续 mutation）", async ({ baseURL }) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}${PREVIEW_PATH}?__sitecraftSnapshotProbe=1`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3000);

      const baseline = await page.evaluate(() => window.__sitecraftSnapshotState.observeCalls());

      // 持续制造合法 mutation（不触发还原：内容元素数始终高于快照一半）
      await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        window.__churn = window.setInterval(() => {
          const d = document.createElement("div");
          d.setAttribute("data-churn", "1");
          d.textContent = "churn";
          main.appendChild(d);
          if (main.querySelectorAll("[data-churn]").length > 40) {
            main.querySelectorAll("[data-churn]").forEach((el) => el.remove());
          }
        }, 120);
      });
      await page.waitForTimeout(2500);

      const midCalls = await page.evaluate(() => window.__sitecraftSnapshotState.observeCalls());
      expect(
        midCalls - baseline,
        "持续 mutation 期间观察者没有任何调用——它已经提前收工了",
      ).toBeGreaterThan(3);

      // 停掉 churn，立刻清空 —— 「水合清空」的时刻到了
      await page.evaluate(() => {
        window.clearInterval(window.__churn);
        const main = document.querySelector("main") ?? document.body;
        main.replaceChildren(document.createElement("script"), document.createElement("style"));
      });

      let recovered = 0;
      for (let i = 0; i < 16; i += 1) {
        recovered = await page.evaluate(() => document.body.innerText.trim().length);
        if (recovered > 0) break;
        await page.waitForTimeout(250);
      }
      expect(
        recovered,
        "观察者提前收工了——清空时已无人值守，内容回不来。\n" +
          "收工判据必须是**时间**（活满 WATCH_MS），不能是「内容看起来稳定」。",
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
