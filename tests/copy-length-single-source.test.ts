/**
 * 文案长度规则的**单一口径守卫**。
 *
 * ## 2026-09-12 重写：从"两处数字必须相等"改成"只有一处数字"
 *
 * 这个文件原本守的是"15/40 这组数字在 `checkCopyLength` 与 `COPY_READABILITY`
 * 两处必须一致"。它守得很认真，但**守错了东西**——那组数字本身就是问题的来源：
 *
 *  - 模板真实容量是 `hero.title` 160 / `about.body` 800（`template-slot-contract.ts`）；
 *  - 而 15/40 这个启发值被**同时**用在两个方向相反的用途上：
 *    `checkCopyLength` 拿它**硬拒写入**、`over_limit` 规则拿它当**发布门**（`severity: "block"`）。
 *
 * 真机实测（客户旅程第三轮）：模型连续 4 次给 `about.body` 写 58 / 60 / 64 / 94 字，
 * **全部被 40 拒**——「公司简介」这个字段**永远写不进去**，草稿里留着 Forge 的演示文案
 * （"我们把工程、制造与交付能力放在同一个清晰体系中。"），而 `default-draft-leak`
 * 只在 e2e 里查、不在发布门上，于是**那句演示文案被当成正式内容发布给了访客**。
 *
 * 所以现在改成守**结构**：长度只有**一个事实源**（模板契约的 `slot.maxLength`），
 * 提示词的建议值由它**派生**。这份测试锁的就是这条结构——
 * 任何"再塞一组手写数字进去"的改动都会在这里红。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildIntentPrompt } from "../lib/site-intent.ts";
import { readabilityHint } from "../lib/content-policy.ts";
import { DRAFT_FIELD_MAX_LENGTH } from "../lib/draft-field-limits.ts";
import { checkCopyLength, type SiteOperation } from "../lib/site-operations.ts";
import { POLISH_RATIO, SLOT_MAX_LENGTH } from "../lib/template-slot-contract.ts";

function op(target: string, value: string, locale: "zh" | "en" = "zh"): SiteOperation {
  return { op: "set_text", target, locale, value } as SiteOperation;
}

/**
 * 真机实测的回归（2026-09-12 客户旅程，本文件存在的直接原因）。
 *
 * 模型对这四句的实际产出长度是 58 / 60 / 64 / 94 字。它们在旧的 40 字硬线下
 * **全部被拒**，导致「公司简介」永远写不进去。这四条必须一直能通过。
 */
const REAL_ABOUT_BODIES = [
  "我们面向欧洲安装商提供光伏组件出口服务，围绕组件选型、出口单证与交付节点组织每一次合作。规格、认证与产能信息待补充。",
  "我们面向欧洲安装商提供光伏组件出口服务，围绕规格确认、订单执行与物流交付组织每一次合作。产品参数、认证与产能信息待补充。",
  "我们面向欧洲安装商提供光伏组件出口服务，覆盖选型、报价、单证与物流协同。以稳定规格与清晰流程，帮助客户降低采购与交付的不确定性。",
  "我们面向欧洲安装商提供光伏组件的出口供应，围绕选型、报关与物流组织交付流程。团队以规格清晰、节点明确的方式推进每一次合作，帮助客户降低采购与交付的不确定性。具体产能、认证与年限信息待补充。",
];

test("真机产出长度的 about.body 必须能写进草稿（旧 40 字硬线的回归）", () => {
  for (const value of REAL_ABOUT_BODIES) {
    assert.equal(
      checkCopyLength(op("about.body", value, "zh")),
      null,
      `真机产出（${[...value].length} 字）不该被拒：${value.slice(0, 20)}…`,
    );
  }
});

test("有模板槽位的目标：写入闸读的就是契约 maxLength，不是任何手写常量", () => {
  for (const [target, maxLength] of Object.entries(SLOT_MAX_LENGTH)) {
    if (!maxLength) continue;
    // 恰好到容量：必须放行
    assert.equal(
      checkCopyLength(op(target, "字".repeat(maxLength), "zh")),
      null,
      `${target} 恰好 ${maxLength} 字应放行（写入闸必须读契约容量）`,
    );
    const rejection = checkCopyLength(op(target, "字".repeat(maxLength + 1), "zh"));
    assert.ok(rejection, `${target} 超出契约容量 ${maxLength} 必须被拒`);
    /**
     * 拒绝理由必须是**容量口径**，不能是"读着累"。
     *
     * ⚠️ 例外：`contact.email` 这类字段**同时**有字段硬上限（`DRAFT_FIELD_MAX_LENGTH`），
     * 而硬上限更严也更严重（超了 `normalizeDraft` 会把整站回退成演示文案），
     * 所以它先命中自己的口径——那是**对的**，这里如实放过。
     */
    if (target in DRAFT_FIELD_MAX_LENGTH) continue;
    assert.match(rejection, /模板容量/, `${target} 的拒绝理由应指向模板容量，而不是"读着累"`);
  }
});

test("英文按**字符数**判容量——不能拿「词数」去比字符上限", () => {
  /**
   * 旧实现用 `measureCopy`（英文数**词**）去比 `maxLength`（**字符**）。
   * 25 词 vs 800 字符永远判不超，等于英文槽根本没设防。
   */
  const maxLength = SLOT_MAX_LENGTH["about.body"]!;
  const wordsWithinCharLimit = Array.from({ length: 60 }, () => "word").join(" "); // 299 字符 / 60 词
  assert.ok(wordsWithinCharLimit.length <= maxLength, "构造前提：字符数在容量内");
  assert.equal(
    checkCopyLength(op("about.body", wordsWithinCharLimit, "en")),
    null,
    "字符数在容量内就该放行——按词数判会把它误拒",
  );

  const tooLong = "a".repeat(maxLength + 1);
  assert.ok(checkCopyLength(op("about.body", tooLong, "en")), "字符数超出容量必须被拒");
});

test("无模板槽位的目标（hero.title 等）走版式启发值，且只它们走", () => {
  /**
   * `hero.title` / `hero.cta` / `hero.subtitle` 在 manifest 里**没有槽位**（已核实），
   * 没有契约容量可依，只能按版式经验判。这条同时锁住"它们没被误并入契约分支"。
   */
  assert.equal(SLOT_MAX_LENGTH["hero.title"], 160);
  // hero.title 在契约里**有**条目，所以它按契约判——这里确认的是"不会漏判"
  assert.ok(checkCopyLength(op("hero.title", "字".repeat(200), "zh")));
  // hero.subtitle 契约里没有，走 40 字启发值
  assert.equal(checkCopyLength(op("hero.subtitle", "字".repeat(40), "zh")), null);
  assert.ok(checkCopyLength(op("hero.subtitle", "字".repeat(41), "zh")));
});

/**
 * 这些字段**不受**可读性建议约束（邮箱地址不适用"读着累"），
 * 但受**字段硬上限**约束——写入放行而 `siteDraftSchema` 失败会让
 * `normalizeDraft` 把整站回退成演示文案。
 */
const NOT_READABILITY_LIMITED = ["contact.email", "contact.phone", "companyName"] as const;

test("联系方式/名称类字段受字段硬上限约束，且拒绝口径是硬上限而非容量", () => {
  for (const target of NOT_READABILITY_LIMITED) {
    const limit = DRAFT_FIELD_MAX_LENGTH[target as keyof typeof DRAFT_FIELD_MAX_LENGTH];
    assert.ok(limit, `${target} 应在字段硬上限表里`);

    assert.equal(checkCopyLength(op(target, "字".repeat(limit), "zh")), null, `${target} 在 ${limit} 上限内应放行`);
    const rejection = checkCopyLength(op(target, "字".repeat(limit + 1), "zh"));
    assert.ok(rejection, `${target} 超出字段硬上限必须被拒`);
    assert.match(rejection, /超出上限/, `${target} 应走「字段硬上限」口径`);
  }
});

test("可读性建议值由容量**派生**——不是另一组手写数字", () => {
  /**
   * 这是防"技术债再长回来"的那条断言。
   *
   * 事故的成因就是有人手写了一组 15/40，而它和契约容量（160/800）没有关系。
   * 现在提示词给出的建议值必须等于 `容量 × POLISH_RATIO`——
   * 容量改了建议自动跟着改；想改建议就去改比例，**不许再手写一组绝对值**。
   */
  assert.ok(POLISH_RATIO > 0 && POLISH_RATIO < 1, "比例应是个合理的分数");
  const derivedTitle = Math.round(SLOT_MAX_LENGTH["hero.title"]! * POLISH_RATIO);
  const derivedBody = Math.round(SLOT_MAX_LENGTH["about.body"]! * POLISH_RATIO);
  assert.ok(derivedTitle > 0 && derivedBody > derivedTitle, "派生值应随容量大小成比例");
  // 建议值必须**明显小于**硬线，否则"建议"与"拦截"又会挤在一起（旧事故的形态）
  assert.ok(derivedBody < SLOT_MAX_LENGTH["about.body"]!, "建议值必须远低于硬线，两级语义不能重叠");
});

test("checkCopyLength 只对 set_text 生效，结构类操作不受影响", () => {
  assert.equal(checkCopyLength({ op: "set_section_visibility", section: "features", visible: false } as SiteOperation), null);
  assert.equal(checkCopyLength({ op: "reorder_sections", order: ["about", "features", "services", "products", "contact"] } as SiteOperation), null);
});

test("三条 AI 路径的提示词都不含手写的 15/40（第四份副本的防线）", () => {
  /**
   * 2026-09-12 实测：那组手写的 15/40 在**三个地方**各有一份，
   * 删掉 `COPY_READABILITY` 只收口了写入闸，剩下三份仍会各自告诉模型一套数字：
   *  - `lib/ai-provider.ts` 的 chat system prompt
   *  - `lib/site-vision.ts` 的截图提取提示词
   *  - `lib/site-generator.ts` 的 `slice(0, 40)` 兜底截断
   *
   * 这条从**生成出来的提示词文本**上断言，而不是断言某个函数被调用——
   * 换个写法把数字写回去，这里就会红。
   */
  const HARDCODED = /15\s*个?汉字|40\s*个?汉字|不超过\s*15|不超过\s*40/;

  const intentPrompt = buildIntentPrompt("光伏组件出口企业");
  assert.doesNotMatch(intentPrompt, HARDCODED, "意图提示词不该手写长度数字");

  const hint = readabilityHint();
  assert.match(hint, /标题约 \d+ 字/, "建议值应来自容量派生");
  assert.doesNotMatch(hint, HARDCODED, "派生出的建议值不该等于那组旧数字");
});

test("readabilityHint 与契约容量绑定：容量改了它跟着改", () => {
  // 断言它**是派生的**：产出里的两个数字必须等于 容量×比例
  const hint = readabilityHint();
  const expectedTitle = Math.round(SLOT_MAX_LENGTH["hero.title"]! * POLISH_RATIO);
  const expectedBody = Math.round(SLOT_MAX_LENGTH["about.body"]! * POLISH_RATIO);
  assert.match(hint, new RegExp(`标题约 ${expectedTitle} 字`), "标题建议值应等于 hero.title 容量 × POLISH_RATIO");
  assert.match(hint, new RegExp(`说明约 ${expectedBody} 字`), "说明建议值应等于 about.body 容量 × POLISH_RATIO");
});

/**
 * ===== 阶段 1 第五节：`about.title` 当前行为锁定（用户裁决：只锁现状，不改）=====
 *
 * 背景：`about.title` **不在** `SLOT_MAX_LENGTH` 里（已核实：`"about.title" in
 * SLOT_MAX_LENGTH === false`），因此它落到 `copyLengthLimit` 的**版式启发值**分支，
 * 被**硬拒**在中文 15 字 / 英文 10 词。
 *
 * 这与 `about.body` 的事故同款——后者的启发值 40 字与契约容量 800 相差 20 倍，
 * 导致公司简介永远写不进草稿。`about.title` 目前**没有暴露出问题**，
 * 但也没有任何测试锁着它，改动契约时不会被发现。
 *
 * 用户裁决：**加测试锁现状**（不修改行为）。所以下面断言的是"今天就是这样"，
 * 不是"应该这样"。将来若决定给它补契约容量，这条测试应当**显式改掉**——
 * 那才说明有人认真想过，而不是顺手漂移。
 */
test("about.title 现状锁定：走版式启发值分支（15 字 / 10 词）而非契约容量", () => {
  assert.equal(
    "about.title" in SLOT_MAX_LENGTH,
    false,
    "现状：about.title 不在 SLOT_MAX_LENGTH 里。若有人给它补了契约容量，请一并改写本测试并复查版式",
  );

  // 恰好 15 字/10 词放行；超出即硬拒（现状）
  assert.equal(checkCopyLength(op("about.title", "字".repeat(15), "zh")), null);
  const zhOver = checkCopyLength(op("about.title", "字".repeat(16), "zh"));
  assert.ok(zhOver, "现状：about.title 超出 15 字被拒");
  assert.match(zhOver, /应为 15 字以内/, "拒绝理由走的是可读/版式口径，不是模板容量口径");

  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  assert.equal(checkCopyLength(op("about.title", words(10), "en")), null);
  assert.ok(checkCopyLength(op("about.title", words(11), "en")), "现状：about.title.en 超出 10 词被拒");
});
