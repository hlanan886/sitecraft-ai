/**
 * 槽位契约的**单一真相源**（阶段 4 契约收敛，2026-09-11）。
 *
 * ## 为什么要有这个文件
 *
 * 此前同一个槽位信息有多份**互相独立的拷贝**：
 *  - `lib/template-manifests/shared.ts` 的 `contentSlots()` 硬编码一份 `maxLength` 表；
 *  - `lib/template-runtime.ts` 的 `DEFAULT_SLOT_MAX_LENGTH` 又抄了**逐项完全相同**的一份；
 *  - 两份都无交叉校验，测试只断言 `typeof === "number" && > 0`
 *    （`tests/template-manifest.test.ts:61-62`）——**改一处必漂，且没人会知道**。
 *
 * 本模块是**无依赖的叶子模块**（不 import 任何业务模块），因此
 * `template-manifests/` 与 `template-runtime.ts` 可以同时引用它而**不可能成环**。
 *
 * ## 注意：这里放的是「schema 硬上限」，不是「可读性推荐值」
 *
 * 两者是**不同的约束，必须并存**（见 `lib/content-quality.ts:141-155` 的说明）：
 *  - 本表 `SLOT_MAX_LENGTH` = 存不下 / 会破版的硬上限；
 *  - `COPY_READABILITY`（标题 15 / 正文 40）= "读着累"的软建议。
 *
 * ⚠️ **本表的数值目前仍是估算的，不是实测的。** 阶段 3 会用「实测破版点」替换它们，
 * 届时本文件就是**唯一需要改的地方**——这正是把它抽出来的意义。
 */
/**
 * 「读着累」的建议线 = 上面容量的这个比例。
 *
 * ## 为什么是从容量派生，而不是另一组数字
 *
 * 2026-09-12 真机实测的事故：系统里曾有一组**手写**的可读性数字（15/40），
 * 而 `about.body` 的真实容量是 **800**。那组数字被 `checkCopyLength` 用来**硬拒写入**、
 * 又被 `over_limit` 规则当**发布门**（`severity: "block"`）——于是模型正常写出的
 * 58/60/64/94 字**全部被拒**，「公司简介」永远写不进去，草稿里留着模板演示文案
 * 并被当成正式内容**发布给了访客**。
 *
 * 根子是"有两组数字，且没人知道它们该是什么关系"。现在只剩一组（`SLOT_MAX_LENGTH`），
 * 建议值由它**按比例派生**：容量改了（`SLOT_MAX_LENGTH` 的注释明说阶段 3 要换成实测破版点），
 * 建议自动跟着改，不会再有第二个真相源。
 *
 * 只用于**给模型的写作建议**，不参与任何拦截。
 */
export const POLISH_RATIO = 0.15;

export const SLOT_MAX_LENGTH = Object.freeze({  "hero.title": 160,
  "hero.cta": 160,
  "about.body": 800,
  "features.items": 1800,
  "services.items": 1800,
  products: 2400,
  "contact.title": 160,
  "contact.body": 800,
  "contact.email": 240,
  "contact.phone": 80,
  "contact.address": 1000,
} as const);

/** 未登记槽位的兜底上限。取一个足够大、但能防「模型吐无限长」的值。 */
export const SLOT_MAX_LENGTH_FALLBACK = 2000;

export function slotMaxLength(target: string): number {
  return (SLOT_MAX_LENGTH as Record<string, number>)[target] ?? SLOT_MAX_LENGTH_FALLBACK;
}
