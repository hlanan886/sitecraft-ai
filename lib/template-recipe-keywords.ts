import { categoryFromKeywords } from "./site-intent.ts";

/**
 * 分类同义词的**从属来源**。
 *
 * ## 与 `site-intent.ts` 的 `CATEGORY_KEYWORDS` 什么关系（2026-09-11，③接-1b 改写）
 *
 * 从前是"两张独立的表，靠注释提醒别漂"——**结果就漂了**，而且**光看注释无法判断哪张对**。
 *
 * 现在的关系是**主从**：
 *  - `site-intent.ts` 的 `CATEGORY_KEYWORDS` 是**正典**——它被
 *    `tests/golden-intent.test.ts` 的行业金表锁着，改错了测试会红；
 *  - 本表是**补充**：只放正典里没有、但用户真会说的说法
 *    （"做机械设备的""开发了一个软件系统"这种口语）。
 *
 * `tests/category-consistency.test.ts` 在固定语料上比对两边结果，**分歧即 bug**。
 * 往这里加词不会改变已有判定（正典先赢），所以是安全的；
 * 想改变判定就去改正典——那才是它被金表锁着的原因。
 *
 * ## 词从哪来
 *
 * 从**用户真实会说的话**里来（"做个风机厂""包装印刷""光伏出口"），
 * 不是从模板描述里抄的。宁可多加几个近义词——漏掉一个词的代价是
 * "本来能省一次模型调用却没省"，而多一个词的代价只是"多命中一次"。
 */
export const CATEGORY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  制造业: [
    "制造", "工厂", "厂", "机械", "设备", "零部件", "五金", "模具", "风机", "泵", "阀",
    "电气", "工业", "材料", "加工", "生产", "车间", "包装", "印刷", "钢材", "金属",
    "化工", "轴承", "紧固件", "螺丝", "管道", "仪表", "装配", "做机械", "做设备",
  ],
  外贸目录: [
    "外贸", "出口", "海外", "跨境", "国际贸易", "外贸站", "询盘", "b2b", "欧美",
    "全球客户", "国际", "报关", "货运", "订单", "做外贸", "做出口", "英文站",
  ],
  科技企业: [
    "科技", "软件", "saas", "系统", "平台", "app", "应用", "互联网", "数据", "云",
    "智能", "算法", "开发", "开发者", "api", "工具", "技术", "信息化", "数字化",
    "人工智能", "ai", "小程序", "网站开发", "做软件", "做系统", "开发的",
  ],
  专业服务: [
    "服务", "咨询", "设计", "律师", "法律", "会计", "财税", "广告", "营销", "策划",
    "培训", "教育", "装修", "装饰", "摄影", "工作室", "事务所", "agency", "顾问",
    "人力", "招聘", "品牌", "咖啡", "餐厅", "店", "民宿", "美容", "健身",
  ],
  其他: ["作品集", "个人", "博客", "简历", "portfolio", "摄影集"],
};

/**
 * 把一句话归到一个分类。
 *
 * ## 顺序：**正典先赢**（③接-1b）
 *
 * 先问 `categoryFromKeywords`（正典，被行业金表锁着）。它认出来就用它——
 * 这样"光伏出口"这类需要优先级判断的句子，判定权在**一处**，
 * 本表里的词**永远不会推翻它**。
 *
 * 只有正典认不出来时，才用本表的同义词兜（"咖啡店""包装印刷厂"这类
 * 正典里没有的口语说法）。
 *
 * ## 为什么兜底用"计票"而不是"第一个命中"
 *
 * 正典用有序正则（优先级是刻意的）；这里没有优先级可言，
 * 一票一票数最直白。平手按分类名的字面顺序——**可复现**比"看起来更聪明"重要。
 */
export function categoryFromUserText(text: string): string | null {
  const canonical = categoryFromKeywords(text);
  if (canonical) return canonical;

  const lower = text.toLowerCase();
  let best: { category: string; hits: number } | null = null;
  for (const [category, words] of Object.entries(CATEGORY_SYNONYMS)) {
    let hits = 0;
    for (const word of words) {
      if (lower.includes(word)) hits += 1;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { category, hits };
  }
  return best?.category ?? null;
}
