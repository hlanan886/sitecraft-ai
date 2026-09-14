/**
 * 面向用户的操作错误翻译（2026-09-10）。
 *
 * 背景：真机实测中，一句话建站的生成失败时，界面直接显示
 * `features item 4 does not exist` —— 英文、技术化、对中文用户完全不可理解。
 * 来源是 app/api/sites/[siteId]/generate/route.ts 把 `error.message` 原样透传。
 *
 * 设计原则：
 * - **只翻译已知模式**，未知错误保留原文（宁可露出技术细节，也不要误译成
 *   与事实不符的中文——那会让用户和排查者都走弯路）。
 * - 给出**用户能做的下一步**，而不只是描述症状。
 * - 匹配用「结构化特征」（section 名 + 索引），不依赖完整英文句子，
 *   因为错误文案可能随实现微调。
 */

const SECTION_LABELS: Record<string, string> = {
  hero: "首屏",
  about: "关于",
  features: "优势",
  services: "服务",
  products: "产品",
  contact: "联系",
  navigation: "导航",
};

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

/**
 * 把内部错误消息转成用户可读文案。
 * 返回 null 表示"不认识"，由调用方决定回退策略。
 */
export function translateGenerationError(message: string): string | null {
  const raw = String(message ?? "").trim();
  if (!raw) return null;

  // `<section> item <n> does not exist`（applySiteOperations 抛出）
  // index 是 0 基的，用户看到要 +1
  const itemMissing = raw.match(/^(\w+)\s+item\s+(\d+)\s+does not exist$/i);
  if (itemMissing) {
    const [, section, index] = itemMissing;
    const label = sectionLabel(section);
    return `生成的「${label}」板块内容与模板不匹配（第 ${Number(index) + 1} 条超出模板可容纳的条数）。可重试生成，或直接进入工作台手动调整。`;
  }

  // `Card <id> does not exist`
  const cardMissing = raw.match(/^Card\s+(.+?)\s+does not exist$/i);
  if (cardMissing) {
    return `要修改的卡片已不存在（可能已被其他操作改动）。请刷新后重试。`;
  }

  // `Product <sku> does not exist`
  const productMissing = raw.match(/^Product\s+(.+?)\s+does not exist$/i);
  if (productMissing) {
    return `要修改的商品已不存在（可能已被其他操作改动）。请刷新后重试。`;
  }

  // 操作前置条件不匹配（并发保护）
  if (/不匹配|precondition/i.test(raw) && /expected/i.test(raw)) {
    return "内容已被其他操作改动，本次修改未应用。请刷新后重试。";
  }

  return null;
}

/**
 * 安全版：认识的翻译，不认识的保留原文。
 * 调用方应优先使用这个，避免"翻译层吞掉未知错误"导致排查线索丢失。
 */
export function userFacingGenerationError(message: string, fallback = "生成失败"): string {
  return translateGenerationError(message) ?? (String(message ?? "").trim() || fallback);
}
