/**
 * 沉淀模板的槽位补全（2026-09-10，方向 3 阶段 A）。
 *
 * ## 这个模块在整条链路里的位置
 *
 * 方向 3 的核心洞察是：**由谁写 HTML，谁就该顺手写下 `data-sitecraft-slot`**。
 * 人工在别人的 HTML 里找节点打属性是 200 行/模板；由我们生成的 HTML 里带上属性，
 * 成本是 0。整套就地编辑（`lib/inline-edit-mapping.ts`）、覆盖统计、
 * 忠实度门禁**全部**依赖这个属性。
 *
 * 于是本模块的职责不是「猜出模板结构」，而是**兜住 AI 的疏漏**：
 *
 *   ① 清点 HTML 里已有哪些槽位（事实来源，交给装载器生成 manifest）
 *   ② 对**判定规则唯一**的单节点槽位补属性（h1 → hero.title、mailto → contact.email）
 *   ③ 对**判定规则不唯一**的集合槽位（features.items 等）**拒绝猜**，报 warning 交回上游
 *
 * ## 为什么故意不做通用 HTML 重写
 *
 * 没有 HTML 解析器（项目零额外依赖），正则重写 `</h1>` 之类的边界处理极易出错，
 * 而**错误注入一个槽位比不注入更糟**：AI 会把内容写进一个语义不对的节点，
 * 用户看到的是「内容跑到奇怪的地方去了」，且没有任何报错。
 * 所以这里的规则全是「唯一且可证」的：
 *
 * | 槽位 | 定位规则 | 唯一性理由 |
 * |---|---|---|
 * | `hero.title` | 文档中**第一个** h1 | HTML 语义规定单页一个主标题 |
 * | `contact.email` | 第一个 `mailto:` 链接 | 协议前缀唯一 |
 * | `contact.phone` | 第一个 `tel:` 链接 | 协议前缀唯一 |
 * | `contact.address` | 第一个 `<address>` | 元素语义唯一 |
 *
 * 其余一律不注入——把判断交回环节 ②/③ 的人或 AI。
 */

/**
 * 可直接注入的槽位规则。
 *
 * 每条规则是「找到唯一候选节点 → 在开标签里插入属性」。
 * 只覆盖**开标签本身可被正则精确切分**的情形：属性插在 `>` 之前，
 * 不涉及标签配对，因此不会因为自闭合/嵌套而错位。
 */
type InjectionRule = {
  target: string;
  label: string;
  pattern: RegExp;
  /**
   * 从匹配结果里取「开标签的结束位置」。默认取 `match.index + match[0].length`，
   * 即整段匹配的末尾；需要精确定位到 `>` 的规则用 `tagEnd` 覆盖。
   */
  findTagEnd?: (html: string, matchIndex: number, matchLength: number) => number;
};

function firstTagEnd(html: string, matchIndex: number, matchLength: number): number {
  // 匹配形如 `<h1 ...>`，最后一个字符就是 `>`。
  return matchIndex + matchLength;
}

const INJECTION_RULES: readonly InjectionRule[] = [
  {
    target: "hero.title",
    label: "首屏主标题",
    // 只认**开标签**：`<h1` 后面跟属性或直接 `>`。`(?![\w-])` 避免匹配 `<h1x` 这类未知标签。
    pattern: /<h1(?![\w-])[^>]*>/i,
    findTagEnd: firstTagEnd,
  },
  {
    target: "contact.email",
    label: "联系邮箱",
    // 抓 `href="mailto:..."` 所在的整个开标签。
    pattern: /<a(?![\w-])[^>]*href\s*=\s*["']mailto:[^"']*["'][^>]*>/i,
    findTagEnd: firstTagEnd,
  },
  {
    target: "contact.phone",
    label: "联系电话",
    pattern: /<a(?![\w-])[^>]*href\s*=\s*["']tel:[^"']*["'][^>]*>/i,
    findTagEnd: firstTagEnd,
  },
  {
    target: "contact.address",
    label: "联系地址",
    pattern: /<address(?![\w-])[^>]*>/i,
    findTagEnd: firstTagEnd,
  },
];

export type SlotPostProcessResult = {
  /** 补全后的 HTML。 */
  html: string;
  /**
   * HTML 里**最终**存在的槽位前缀。
   *
   * 注意：本模块只做「补全 + 清点」，**不做结构推断**。这里可能只列出
   * `hero.title` —— 因为 AI 产出的 HTML 本来就没带集合型槽位，
   * 而本模块刻意不猜（见文件头）。这样一个模板会「能预览、但只有首屏可编辑」，
   * 属于**设计内**的结果，调用方应据此决定是否打回上游重做。
   */
  slots: string[];
  /** 需要上游（人或 AI）明确声明、本模块拒绝猜的槽位及原因。 */
  warnings: string[];
};

/**
 * 需要一个完整可编辑模板**至少**应具备的槽位。
 *
 * 只列「缺了就说明模板没接好」的三项：首屏标题 + 两组集合内容。
 * 不做成「10 个全都要」——很多真实模板本就没有 products 或 contact 表单，
 * 强求全部会把正常模板也标成不合格。
 */
const MINIMUM_EDITABLE_SLOTS = ["hero.title", "about.body", "features.items", "services.items"] as const;

/**
 * 清点 HTML 里已有的槽位前缀。
 *
 * 与 `template-runtime-loader.collectSlotTargetsFromHtml` 同源逻辑，
 * 但**不共享实现**：那边读文件、在服务端装载路径上，这边处理的是内存里的字符串。
 * 强行合并会逼出一层「先写盘再读」的绕路，反而更难懂。
 */
function scanExistingSlots(html: string): Set<string> {
  const found = new Set<string>();
  const pattern = /data-sitecraft-slot\s*=\s*["']([a-zA-Z0-9_.-]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const parts = match[1].split(".");
    if (parts.length >= 2) found.add(`${parts[0]}.${parts[1]}`);
  }
  return found;
}

/**
 * 从 HTML 的开标签里安全地插入一个属性。
 *
 * 关键约束：只在**第一个**候选节点上注入。若模板里有多个 h1（不合语义但存在），
 * 注入第一个是唯一可辩护的选择——bridge 的 `findHero()` 也是取第一个可见的。
 */
function insertSlotAttribute(html: string, rule: InjectionRule): { html: string; injected: boolean } {
  const match = rule.pattern.exec(html);
  if (!match || match.index === undefined) return { html, injected: false };
  const tagEnd = (rule.findTagEnd ?? firstTagEnd)(html, match.index, match[0].length);
  const tag = html.slice(match.index, tagEnd);
  // 已有槽位属性就不动它——上游（阶段 B 的 AI）显式写下的声明优先于我们的推断。
  if (/data-sitecraft-slot/i.test(tag)) return { html, injected: false };
  // 插在 `>` 之前，保留原有的 `/`（若有）与全部既有属性。
  const insertAt = tag.lastIndexOf(">");
  if (insertAt < 0) return { html, injected: false };
  const rewritten = `${tag.slice(0, insertAt)} data-sitecraft-slot="${rule.target}"${tag.slice(insertAt)}`;
  return { html: html.slice(0, match.index) + rewritten + html.slice(tagEnd), injected: true };
}

/**
 * 沉淀模板 HTML 的写入前处理。
 *
 * 纯函数（无 fs），便于单测直接喂字符串断言。
 */
export function postProcessPrecipitatedTemplateHtml(html: string): SlotPostProcessResult {
  const existing = scanExistingSlots(html);
  const warnings: string[] = [];
  let output = html;

  for (const rule of INJECTION_RULES) {
    if (existing.has(rule.target)) continue;
    const result = insertSlotAttribute(output, rule);
    if (!result.injected) {
      warnings.push(`未能定位${rule.label}（${rule.target}），该字段将不可直接编辑`);
      continue;
    }
    output = result.html;
    existing.add(rule.target);
  }

  // 集合型槽位一律不猜：同一种"三栏卡片"在 HTML 里可以是 article/li/div，
  // 挑错容器会让整块内容的编辑与统计都落在错误节点上。留给上游显式声明。
  const missing = MINIMUM_EDITABLE_SLOTS.filter((target) => !existing.has(target));
  if (missing.length) {
    warnings.push(
      `模板缺少集合/正文槽位（${missing.join("、")}）——本模块不做结构推断，`
      + "需要产出的 HTML 直接带上 data-sitecraft-slot；"
      + "否则该模板能预览，但这些板块的内容无法被 AI 填充或就地编辑。",
    );
  }

  return { html: output, slots: [...existing].sort(), warnings };
}
