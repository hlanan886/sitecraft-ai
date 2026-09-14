#!/usr/bin/env node
/**
 * 阶段 4-1 只读调研：统计已落盘的 operations / inverseOperations。
 *
 * 目的：在定 op 名别名方案**之前**，先摸清存量数据里 `update_item` / `add_item` /
 * `remove_card` / `card:` 批内键的真实出现频次与形态。没摸清就不许动代码（用户裁决第 1 条）。
 *
 * 只读：仅 `readFile`，不写、不迁移、不建连接池（Postgres 走独立的 pnpm 脚本）。
 *
 * 用法：node scripts/survey-persisted-operations.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), ".sitecraft-data", "sites");

/**
 * 负向自检：往站点目录里放一条**人造记录**，确认统计会跟着变。
 * 用法：node scripts/survey-persisted-operations.mjs --selftest
 *
 * 为什么需要：本项目吃过三次"假门禁"的亏（见 glossary 附则 3）。
 * 一个只会打印数字的脚本，如果读错了目录或字段名，输出的是**看起来很正常的 0**。
 */
const selfTest = process.argv.includes("--selftest");
const selftestPath = path.join(rootDir, "__selftest__.json");
if (selfTest) {
  await (await import("node:fs/promises")).writeFile(selftestPath, JSON.stringify({
    siteId: "__selftest__",
    draft: {},
    history: [{
      id: "selftest", baseRevision: 0, revision: 1, summary: "selftest", source: "ai",
      operations: [{ op: "update_card", section: "features", index: 0, locale: "zh", title: "x" }],
      inverseOperations: [], appliedTargets: [], createdAt: "1970-01-01T00:00:00.000Z",
    }],
    future: [], updatedAt: "1970-01-01T00:00:00.000Z",
  }));
}
const sitesDir = rootDir;

const LEGACY_OPS = new Set(["update_card", "add_card", "remove_card"]);

const opCounts = new Map();          // op 名 -> 次数
const legacyShapes = new Map();      // 旧 op 的字段形态指纹 -> 次数
const sectionCounts = new Map();     // 旧 op 的 section 取值 -> 次数
const changeSourceCounts = new Map();
const filesWithHistory = [];
const filesWithLegacy = [];
const errors = [];
let totalChangeSets = 0;
let totalHistoryChangeSets = 0;
let totalFutureChangeSets = 0;
let totalForwardOps = 0;
let totalInverseOps = 0;
let totalLegacyForward = 0;
let totalLegacyInverse = 0;
const cardPrefixedNonOp = new Map(); // 非 op 位置的 "card:" 前缀出现（幂等键候选）

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** 记录的字段形态指纹：键名排序后拼接，值类型用 typeof —— 只记形状，不记内容。 */
function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array<${value.length ? shapeOf(value[0]) : "empty"}>`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().join(",")}}`;
  }
  return typeof value;
}

function scanOperation(operation, where) {
  if (!operation || typeof operation !== "object") return;
  const op = operation.op;
  bump(opCounts, `${where}:${String(op)}`);
  if (LEGACY_OPS.has(op)) {
    if (where === "forward") totalLegacyForward += 1;
    else totalLegacyInverse += 1;
    bump(legacyShapes, `${op} ${shapeOf(operation)}`);
    if (typeof operation.section === "string") bump(sectionCounts, `${op} section=${operation.section}`);
    if (typeof operation.itemId === "string") bump(sectionCounts, `${op} 带 itemId`);
  }
}

/** 递归找非 op 字段里带 "card:" 前缀的字符串（幂等键 / 协议串候选）。 */
function scanProtocolStrings(value, trace, depth) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.startsWith("card:")) bump(cardPrefixedNonOp, `${trace} = card:<...>`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanProtocolStrings(entry, `${trace}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      // op 名本身已单独统计，这里跳过 op/operations/inverseOperations 以免重复计数
      if (key === "op" || key === "operations" || key === "inverseOperations") continue;
      scanProtocolStrings(entry, trace ? `${trace}.${key}` : key, depth + 1);
    }
  }
}

// 保存时 writeRecord 用 structuredClone 写出，JSON 里不可能出现 undefined/函数，
// 所以这里的形态统计能覆盖全部合法记录形态。
let files;
try {
  files = await readdir(sitesDir);
} catch (error) {
  console.error(`读不到 ${sitesDir}：${error.message}`);
  process.exit(1);
}

const jsonFiles = files.filter((name) => name.endsWith(".json"));

for (const name of jsonFiles) {
  let record;
  try {
    record = JSON.parse(await readFile(path.join(sitesDir, name), "utf8"));
  } catch (error) {
    errors.push(`${name}: ${error.message}`);
    continue;
  }
  const history = Array.isArray(record.history) ? record.history : [];
  const future = Array.isArray(record.future) ? record.future : [];
  totalHistoryChangeSets += history.length;
  totalFutureChangeSets += future.length;
  if (history.length || future.length) {
    filesWithHistory.push({ name, history: history.length, future: future.length });
  }
  let fileHadLegacy = false;
  for (const changeSet of [...history, ...future]) {
    totalChangeSets += 1;
    if (typeof changeSet?.source === "string") bump(changeSourceCounts, changeSet.source);
    for (const operation of changeSet?.operations ?? []) {
      totalForwardOps += 1;
      scanOperation(operation, "forward");
      scanProtocolStrings(operation, "", 0);
      if (LEGACY_OPS.has(operation?.op)) fileHadLegacy = true;
    }
    for (const operation of changeSet?.inverseOperations ?? []) {
      totalInverseOps += 1;
      scanOperation(operation, "inverse");
      scanProtocolStrings(operation, "", 0);
      if (LEGACY_OPS.has(operation?.op)) fileHadLegacy = true;
    }
  }
  if (fileHadLegacy) filesWithLegacy.push(name);
}

function dump(title, map, limit = 40) {
  console.log(`\n## ${title}`);
  if (!map.size) {
    console.log("  （无）");
    return;
  }
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  for (const [key, count] of rows) console.log(`  ${String(count).padStart(8)}  ${key}`);
}

console.log("# 存量落盘 operations 调研（只读）");
console.log(`\n数据根：${sitesDir}`);
console.log(`站点记录文件：${jsonFiles.length}`);
console.log(`含 history/future 的文件：${filesWithHistory.length}`);
console.log(`ChangeSet 总数：${totalChangeSets}（history ${totalHistoryChangeSets} / future ${totalFutureChangeSets}）`);
console.log(`forward operations 总数：${totalForwardOps}`);
console.log(`inverseOperations 总数：${totalInverseOps}`);
console.log(`\n**旧名出现次数：forward ${totalLegacyForward} / inverse ${totalLegacyInverse} / 合计 ${totalLegacyForward + totalLegacyInverse}**`);
console.log(`**含旧名的文件数：${filesWithLegacy.length}**`);
if (errors.length) console.log(`\n解析失败：${errors.length} 个（${errors.slice(0, 5).join("; ")}）`);

dump("op 名频次（forward/inverse 分开）", opCounts);
dump("旧 op 的字段形态指纹", legacyShapes);
dump("旧 op 的 section / itemId 取值", sectionCounts);
dump("ChangeSource 分布", changeSourceCounts);
dump("非 op 位置的 card: 前缀串（幂等键候选）", cardPrefixedNonOp);

if (filesWithHistory.length) {
  console.log("\n## 有历史的文件（前 20）");
  for (const entry of filesWithHistory.slice(0, 20)) {
    console.log(`  ${entry.name}  history=${entry.history} future=${entry.future}`);
  }
}

if (selfTest) {
  await (await import("node:fs/promises")).unlink(selftestPath).catch(() => undefined);
  console.log("\n（--selftest 人造记录已清理）");
}
