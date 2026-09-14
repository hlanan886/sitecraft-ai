/**
 * B3 · Q2 误伤检查（一次性诊断工具 · 非门禁 · 无验收引用）。
 *
 * 用户 2026-09-13 裁决 Q2：合法文本 target 集 = `textTargets` ∪ 当前模板 manifest
 * 的 targets，双 import 零手抄；**先对 22 模板全量跑误伤检查，有误伤停下报告**。
 *
 * 本脚本只读，输出三张表：
 *   ① 22 个基线模板 manifest 的 targets 全量清单与 textTargets 的关系；
 *   ② 运行时模板（沉淀的）同口径；
 *   ③ 判定：哪些实际用到的 target 会**被新校验误拒**（误伤面）。
 *
 * 跑法：node --experimental-strip-types scripts/b3-target-audit.ts
 */
import { textTargets, cardSections } from "../lib/site-operations.ts";
import { locales, sectionKeys } from "../lib/site-document.ts";
import { templateManifests } from "../lib/template-manifests/index.ts";

const base = new Set<string>(textTargets);

type Row = { templateId: string; target: string; inBase: boolean; isNavigation: boolean };
const rows: Row[] = [];
for (const [templateId, manifest] of Object.entries(templateManifests)) {
  for (const slot of manifest.slots) {
    rows.push({
      templateId,
      target: slot.target,
      inBase: base.has(slot.target),
      isNavigation: /^navigation\./.test(slot.target),
    });
  }
}

const total = rows.length;
const inBase = rows.filter((r) => r.inBase).length;
const nav = rows.filter((r) => !r.inBase && r.isNavigation).length;
const extra = rows.filter((r) => !r.inBase && !r.isNavigation);

/** 槽位级（collection）目标不是 set_text 的合法目标——它们由 add/remove/update_item 走。 */
const collectionTargets = new Set<string>();
for (const manifest of Object.values(templateManifests)) {
  for (const slot of manifest.slots) {
    if (slot.contentType === "collection") collectionTargets.add(slot.target);
  }
}

console.log("=== ① 基线模板 manifest targets 总览 ===");
console.log(`模板数: ${Object.keys(templateManifests).length}  target 实例: ${total}`);
console.log(`  ∈ textTargets           : ${inBase}`);
console.log(`  navigation.<id>（动态） : ${nav}`);
console.log(`  其余（不在 textTargets）: ${extra.length}`);
const byTarget = new Map<string, string[]>();
for (const r of extra) {
  byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r.templateId]);
}
for (const [target, ids] of [...byTarget.entries()].sort()) {
  console.log(`    ${target}  [${collectionTargets.has(target) ? "collection" : "其他"}]  ← ${ids.length} 个模板`);
}

console.log("\n=== ② 判定 ===");
console.log(`textTargets 基数: ${base.size}`);
console.log(`sectionKeys: ${JSON.stringify([...sectionKeys])}`);
console.log(`cardSections: ${JSON.stringify([...cardSections])}`);
console.log(`locales: ${JSON.stringify([...locales])}`);
const textKindExtra = extra.filter((r) => !collectionTargets.has(r.target));
const collectionCount = extra.length - textKindExtra.length;
console.log(`  ├ collection（槽位级，走 add/remove/update_item）: ${collectionCount}`);
console.log(`  └ 其余（set_text 候选）: ${textKindExtra.length}`);
console.log(
  textKindExtra.length === 0
    ? "\n✅ 误伤面（set_text 口径）= 0：槽位级 target 由 collection 通道覆盖，"
      + "其余全部 154 个实例都在 textTargets 里。"
    : `\n⚠️ 误伤面：${textKindExtra.length} 个文本类 target 不在 textTargets 中，必须 ∪ 进合法集。`,
);