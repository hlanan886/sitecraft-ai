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

/** 年限类：N 年经验/历史（如 "20 年经验"、"25 年"） */
const YEARS_PATTERN = /(\d{1,3})\s*(?:年|years?)\s*(?:经验|历史|制造|积累|深耕|experience)?/i;

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
  const refNorm = normalizeNumber(reference ?? "");
  const found: FactClaim[] = [];
  for (const { source, text } of texts) {
    for (const claim of extractFacts(text)) {
      const confirmed = claim.kind === "years"
        // 年限：数字必须出现在参考里（如参考含"20年"则可信）
        ? (claim.raw.match(/\d+/)?.some((n) => refNorm.includes(n)) ?? false)
        : refNorm.includes(normalizeNumber(claim.raw));
      found.push({ ...claim, confirmed, source });
    }
  }
  // 只返回"草稿声明了、但参考里没有"的（待确认）
  return found.filter((claim) => !claim.confirmed);
}
