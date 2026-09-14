import type { SectionKey } from "./site-document.ts";

export type ChatScope = "site" | "hero" | SectionKey;

export type ChatTask = {
  id: string;
  instruction: string;
  scopes: ChatScope[];
  productSkus: string[];
  selectedTarget: string | null;
  depth: number;
};

const MAX_TASKS = 12;
const MAX_INSTRUCTION_LENGTH = 600;
const allContentScopes: ChatScope[] = ["hero", "about", "features", "services", "products", "contact"];

const scopePatterns: Array<{ scope: ChatScope; pattern: RegExp }> = [
  { scope: "hero", pattern: /首屏|首页|横幅|主标题|副标题|行动按钮|\bhero\b|headline|banner|call.?to.?action|\bcta\b/i },
  { scope: "about", pattern: /关于我们|关于|公司介绍|企业介绍|工厂能力|\babout\b|company profile|factory capability/i },
  { scope: "features", pattern: /核心优势|优势|特点|卖点|feature|advantage|benefit/i },
  { scope: "services", pattern: /服务板块|服务|流程|service|process/i },
  { scope: "products", pattern: /产品板块|产品|商品|目录|\bsku[-_\s]?\w+|product|catalog/i },
  { scope: "contact", pattern: /联系板块|联系我们|联系|询盘|表单|contact|inquiry|enquir|form/i },
  { scope: "site", pattern: /网站名称|企业名称|公司名称|行业|建站目标|配色|圆角|密度|模板|site name|company name|industry|design|template/i },
];

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function scopesFor(text: string): ChatScope[] {
  const matches = scopePatterns.filter((item) => item.pattern.test(text)).map((item) => item.scope);
  return matches.length ? unique(matches) : [...allContentScopes];
}

/**
 * 从选中的 target 推它属于哪个板块（决定 AI 修改的范围）。
 *
 * ## 已知的降级，是刻意的（2026-09-11，⑥）
 *
 * 导航项的 id 现在由数据决定，可以是 `about`（默认那几个）也可是 `nav-1`。
 * 前缀剥掉之后，`about` 能落到 `about` 这个 scope，而 `nav-1` 落不到任何节名上，
 * 于是退回 `"site"`——**范围变宽，不是变错**。
 *
 * 想推准需要拿到草稿（按 id 查那项的 `target`，`#about` → `about`），
 * 而本函数是纯字符串的、没有草稿。**不为了这个精度去改签名**：
 * 多给 AI 一点上下文最坏是"它看到了别处的信息"，比"它看不到要改的地方"轻。
 * 真需要时把 draft 传进来即可，逻辑就三行。
 */
function scopeForTarget(target: string): ChatScope {
  const normalized = target.replace(/^navigation\./, "");
  const scope = allContentScopes.find((item) => normalized === item || normalized.startsWith(`${item}.`));
  return scope ?? "site";
}

function skusFor(text: string): string[] {
  return unique(text.match(/\bSKU[-_][A-Z0-9_-]+\b/gi)?.map((sku) => sku.toUpperCase()) ?? []);
}

function sentencePieces(message: string): string[] {
  const sentences = message
    .split(/[；;。！？!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = sentences.length ? sentences : [message.trim()];
  return source.flatMap((part) => {
    if (part.length <= MAX_INSTRUCTION_LENGTH) return [part];
    const chunks: string[] = [];
    for (let offset = 0; offset < part.length; offset += MAX_INSTRUCTION_LENGTH) {
      chunks.push(part.slice(offset, offset + MAX_INSTRUCTION_LENGTH));
    }
    return chunks;
  });
}

function packPieces(pieces: string[], preserveScopeBoundaries: boolean): Array<Omit<ChatTask, "id" | "depth" | "selectedTarget">> {
  const packed: Array<Omit<ChatTask, "id" | "depth" | "selectedTarget">> = [];
  for (const piece of pieces) {
    const scopes = scopesFor(piece);
    const productSkus = skusFor(piece);
    const previous = packed.at(-1);
    const sameBoundary = previous
      && previous.scopes.join("|") === scopes.join("|")
      && previous.productSkus.join("|") === productSkus.join("|");
    if (previous && (!preserveScopeBoundaries || sameBoundary) && previous.instruction.length + piece.length + 1 <= MAX_INSTRUCTION_LENGTH) {
      previous.instruction += `；${piece}`;
      previous.scopes = unique([...previous.scopes, ...scopes]);
      previous.productSkus = unique([...previous.productSkus, ...productSkus]);
      continue;
    }
    packed.push({ instruction: piece, scopes, productSkus });
  }
  return packed;
}

export function planChatTasks(message: string, selectedTarget?: string | null): ChatTask[] {
  const normalized = message.trim();
  if (selectedTarget) {
    return [{
      id: "task-1",
      instruction: normalized.slice(0, MAX_INSTRUCTION_LENGTH),
      scopes: [scopeForTarget(selectedTarget)],
      productSkus: skusFor(normalized),
      selectedTarget,
      depth: 0,
    }];
  }

  const pieces = sentencePieces(normalized);
  let packed = packPieces(pieces, true);
  if (packed.length > MAX_TASKS) packed = packPieces(pieces, false);
  return packed.slice(0, MAX_TASKS).map((item, index) => ({
    ...item,
    id: `task-${index + 1}`,
    selectedTarget: null,
    depth: 0,
  }));
}

export function splitChatTask(task: ChatTask): ChatTask[] {
  if (task.depth >= 4) return [];
  if (task.scopes.length > 1) {
    return task.scopes.map((scope, index) => ({
      ...task,
      id: `${task.id}.${index + 1}`,
      scopes: [scope],
      productSkus: scope === "products" ? task.productSkus : [],
      depth: task.depth + 1,
    }));
  }

  const clauses = task.instruction
    .split(/并且|以及|同时|；|;|，|,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const parts = clauses.length > 1
    ? clauses
    : [
        task.instruction.slice(0, Math.ceil(task.instruction.length / 2)).trim(),
        task.instruction.slice(Math.ceil(task.instruction.length / 2)).trim(),
      ].filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === task.instruction)) return [];
  return parts.map((instruction, index) => ({
    ...task,
    id: `${task.id}.${index + 1}`,
    instruction,
    depth: task.depth + 1,
  }));
}
