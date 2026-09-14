/**
 * 生成内容事实校验（Q0）
 *
 * 纯函数，只用相对导入（可被 npm test 直接测，不触网）。
 * 职责：扫描草稿里的"高频硬事实"声明（认证/年限/产能/客户数），
 *       与用户提供的参考信息比对；用户未提供的 → 标注"待确认"（不删内容，提示用户核实）。
 *
 * 设计：规则集（正则）而非调模型——快、确定、零成本。
 * 认证/年限/产能/客户数是企业官网最容易被 AI 编造、也最被访客在意的硬事实。
 */

export type FactKind = "certification" | "years" | "capacity" | "customers";

export type FactClaim = {
  kind: FactKind;
  /** 匹配到的原文片段（如 "ISO 9001"、"20 年经验"） */
  raw: string;
  /** 是否能在用户提供的参考信息中找到对应（含则视为可信） */
  confirmed: boolean;
  /** 该事实出现在草稿的哪个文案字段（hero/about/features/services/products/contact） */
  source: string;
};

/** 认证类：常见的第三方认证/资质编号 */
const CERTIFICATION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "ISO 9001", re: /\bISO\s*9001\b/i },
  { label: "ISO 14001", re: /\bISO\s*14001\b/i },
  { label: "ISO 45001", re: /\bISO\s*45001\b/i },
  { label: "CE 认证", re: /\bCE\b/i },
  { label: "TÜV 认证", re: /\bTÜV|TUV\b/i },
  { label: "RoHS", re: /\bRoHS\b/i },
  { label: "UL 认证", re: /\bUL\s*(?:认证|listed|certified)?\b/i },
  { label: "FCC", re: /\bFCC\b/i },
];

/**
 * 年限类：N 年经验/历史（如 "20 年经验"、"25 年"），以及**四位年份**（"成立于 2008 年"）。
 *
 * 上限必须是 4 位：此前是 `\d{1,3}`，于是 "成立于2008年" 只匹配到后三位
 * （抽出 "008年"）。后果不只是少了一位——`checkDraftFacts` 拿 "008" 去比对参考，
 * 会在 "2008" 里**恰好包含**而"碰巧确认"，掩盖了它其实没验证过的事实；
 * 换成整数字边界比对后则直接变成漏报。这类"看起来对了"的假阳性最难发现。
 */
const YEARS_PATTERN = /(\d{1,4})\s*(?:年|years?)\s*(?:经验|历史|制造|积累|深耕|experience)?/i;

/** 产能类：产能/规模/产量（如 "年产 10GW"、"月产能 5000 套"） */
const CAPACITY_PATTERN = /(?:年|月|日)\s*产\s*(?:能)?\s*(\d+(?:\.\d+)?)\s*([A-Za-zµμ]+|[件套台个GWMW])(?:\s*[套件台个GWMW])?/i;

/** 客户数类：服务客户数（如 "服务 500+ 客户"、"serving 300+ clients"） */
const CUSTOMERS_PATTERN = /(?:服务|覆盖|合作|拥有|累计|serving|supporting|for)\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:客户|企业|品牌|clients|customers|家(?:客户|企业|品牌)?)/i;

/** 从一段文案里提取所有高频硬事实声明 */
export function extractFacts(text: string): FactClaim[] {
  const claims: FactClaim[] = [];
  for (const { label, re } of CERTIFICATION_PATTERNS) {
    if (re.test(text)) claims.push({ kind: "certification", raw: label, confirmed: false, source: "" });
  }
  const years = text.match(YEARS_PATTERN);
  if (years) claims.push({ kind: "years", raw: years[0].trim(), confirmed: false, source: "" });
  const capacity = text.match(CAPACITY_PATTERN);
  if (capacity) claims.push({ kind: "capacity", raw: capacity[0].trim(), confirmed: false, source: "" });
  const customers = text.match(CUSTOMERS_PATTERN);
  if (customers) claims.push({ kind: "customers", raw: customers[0].trim(), confirmed: false, source: "" });
  return claims;
}

/** 归一化：把 20 年 / 25years 等转成统一形态，便于比对 */
function normalizeNumber(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/**
 * 校验草稿：扫描所有文案字段，与用户参考信息比对。
 * 返回待确认的事实列表（草稿里有、但用户参考信息里没有的）。
 * @param texts 草稿文案字段（hero/about/features/services/products summary 等的中英文）
 * @param reference 用户提供的参考信息（公司简介/产品清单），可空
 */
export function checkDraftFacts(
  texts: Array<{ source: string; text: string }>,
  reference?: string,
): FactClaim[] {
  const refCompact = compactForCompare(reference ?? "");
  const found: FactClaim[] = [];
  for (const { source, text } of texts) {
    for (const claim of extractFacts(text)) {
      found.push({ ...claim, confirmed: isClaimConfirmed(claim, refCompact), source });
    }
  }
  // 只返回"草稿声明了、但参考里没有"的（待确认）
  return found.filter((claim) => !claim.confirmed);
}

/**
 * 比对用的紧凑形态：去掉空白与千分位、统一小写。
 *
 * 为什么必须去空白：认证类 claim 的 `raw` 是**规范化的标签**（"ISO 9001"），
 * 而用户素材里常写成 "iso9001" 或 "ISO9001"。带空格地 `includes` 永远不命中，
 * 于是**完全忠于素材的那句话反而被判「未确认事实」**，把发布门卡死
 * （2026-09-10 实测：用户粘了真实资质反而发不出去）。
 * 方向 2 的立意就是「以用户素材为准」，这个空格敏感性直接违背它。
 */
function compactForCompare(text: string): string {
  return text.replace(/[\s,，]/g, "").toLowerCase();
}

/** 声明里的数字（含小数）。 */
function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 数字是否作为**完整数字**出现在参考里。
 *
 * 不做朴素 `includes`：那会让 "120" 命中 "1200"，把一个明显不同的产能判成已确认。
 * 前后紧邻字符若是数字（或小数点），继续往后找。
 */
function referenceHasNumber(compactRef: string, value: string): boolean {
  const isDigit = (char: string | undefined) => char !== undefined && /\d/.test(char);
  let from = 0;
  for (;;) {
    const at = compactRef.indexOf(value, from);
    if (at < 0) return false;
    const before = compactRef[at - 1];
    const after = compactRef[at + value.length];
    if (!isDigit(before) && before !== "." && !isDigit(after)) return true;
    from = at + 1;
  }
}

/**
 * 一条声明是否被参考信息确认。
 *
 * 两类比对方式（**不能统一用字符串包含**）：
 *  - 认证：比对规范化标签（去空白/大小写）；
 *  - 数字类（年限/产能/客户数）：比对**数字本身**。原来的实现只对 "years" 这么做，
 *    其余走整句包含——而整句包含了捕获时的上下文词（"服务 120 家"），
 *    素材写"服务**过** 120 家"就对不上，属于同一类假阳性。
 */
function isClaimConfirmed(claim: FactClaim, compactRef: string): boolean {
  if (claim.kind === "certification") return compactRef.includes(compactForCompare(claim.raw));
  const numbers = numbersIn(claim.raw);
  // 数字类声明必然含数字；没有数字说明抽取规则出了问题，按未确认处理（宁严不松）。
  if (!numbers.length) return false;
  return numbers.every((value) => referenceHasNumber(compactRef, value));
}
