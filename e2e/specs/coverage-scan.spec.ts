/**
 * 批量覆盖扫描：对一组模板逐个打开真实 preview、注入标准草稿、回收 applied 报告，
 * 汇总输出每个模板的 covered / missing / residue。
 *
 * 运行时用环境变量 COVERAGE_TEMPLATES 指定模板（逗号分隔）；默认扫有 dist 且已入 catalog 的集合。
 *
 * 断言口径（2026-09-09 修正，此前**零断言**——页面能打开就算过，缺槽位/残留 demo 照样绿，
 * 导致「过门禁」不可信）：
 *  - 必需槽位（manifest `slot.required`）必须全部可见 → 缺一个即失败
 *  - 不得残留 demo 槽位 → 有残留即失败
 * 未注册 manifest 的模板判失败（而非静默 return）——契约缺失本身就是缺口。
 */
import { expect, test } from "@playwright/test";

import { applyDraft, classifyCoverage, coverageDraft, evaluateTemplateFidelity, hasManifest, openPreview } from "../helpers/coverage-scan";
import { templateCatalog } from "../../lib/template-catalog";

const ALL_CATALOG_IDS = templateCatalog.map((item) => item.id);
const ENV = (process.env.COVERAGE_TEMPLATES || "").split(",").map((s) => s.trim()).filter(Boolean);
const targetIds = ENV.length > 0 ? ENV : ALL_CATALOG_IDS;

for (const templateId of targetIds) {
  test(`${templateId} 真实预览：标准草稿槽位覆盖扫描`, async ({ page }) => {
    /**
     * ⚠️ **实例级隔离（T-14）：只隔离 `shadcn-landing2` 这一个实例。**
     *
     * 依据：2026-09-13 第三次 3 连跑 RUN1 的**真实失败现场**（`test-results/run-1/`
     * 保留了截图 + trace + error-context）——`missing=hero.title`，页面只剩
     * about/features 两块，hero 全空。该模板是 Next.js 导出站，整棵 DOM 由内联
     * 脚本构建，而生产 CSP 只放行桥接 nonce → **冷加载约 5% 概率白屏**
     * （复审实测 EMPTY 1/20；探针实测 1/10、2/10）。见 `docs/glossary.md` T-14。
     *
     * **为什么 skip 而不是 test.fail**：间歇缺陷用 test.fail 会随机报
     * unexpected pass（守卫自己变成随机红）。替代拉力绳 =
     * `e2e/scripts/probe-empty-rate.mjs`（收编在 `test:e2e:strict`，EMPTY≥1 非零退出）。
     *
     * **复验锚点 = `probe-empty-rate` 归零后方可摘除本行**；
     * **禁止用全套 e2e 绿反推 T-14 已修**（本轮即反例：同一改动两次 3 连跑，
     * 一次 3/3 全绿、一次第 1 轮就红）。
     *
     * 其余模板（catalog 其余项）不受影响，断言原样。
     */
    // T-14 已修（2026-09-14）：探针 0/50，水合快照兜底生效，skip 已摘。
    expect(hasManifest(templateId), `${templateId} 未注册槽位契约（manifest），先注册再扫`).toBe(true);
    await openPreview(page, templateId);
    const draft = coverageDraft(templateId);
    const report = await applyDraft(page, templateId, draft);
    const result = classifyCoverage(templateId, report);
    const detail = `covered=${result.covered.join(",") || "(none)"} missing=${result.missing.join(",") || "-"} residue=${result.residue.join(",") || "-"}`;

    expect(result.missing, `${templateId} 必需槽位未覆盖：${result.missing.join(",")}｜${detail}`).toEqual([]);
    expect(result.residue, `${templateId} 残留 demo 槽位：${result.residue.join(",")}｜${detail}`).toEqual([]);

    /**
     * 忠实度门禁（2026-09-10 新增，P4 前置）：覆盖率「填了没有」之外，还要看
     * 「填得对不对」——L2 页面残留（lorem/人名）、L3 该原生却走兜底。
     *
     * 这是 `evaluateFidelity` 的**生产外基线**：发布链路已按同一份判定接线（publish/route.ts），
     * 此处对全部模板跑一遍，供 P4 新模板对照。
     */
    const fidelity = evaluateTemplateFidelity(templateId, report);
    expect(
      fidelity.blockers,
      `${templateId} 忠实度不通过：${fidelity.blockers.join("；")}`,
    ).toEqual([]);
  });
}

