#!/usr/bin/env node
/**
 * 阶段 4-1 只读调研（Postgres 侧）：统计 sitecraft_sites 的 history/future 里
 * operations / inverseOperations 的 op 名频次与形态。
 *
 * 只读：SELECT 而已，不建表、不迁移、不写。
 * 连不上（库没起/端口未监听）时**明确报告"无法取证"并退出 2**，
 * 不用 0 冒充"没有旧数据"——本项目吃过假门禁的亏（glossary 附则 3）。
 *
 * 用法：node scripts/survey-persisted-operations-pg.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_OPS = new Set(["update_card", "add_card", "remove_card"]);

let databaseUrl = process.env.DATABASE_URL ?? null;
if (!databaseUrl) {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(process.cwd(), file), "utf8");
      const match = text.split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="));
      if (match) {
        databaseUrl = match.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
        break;
      }
    } catch { /* 文件不存在就继续 */ }
  }
}

if (!databaseUrl) {
  console.error("无法取证：.env/.env.local 与进程环境里都没有 DATABASE_URL。");
  process.exit(2);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function shapeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array<${value.length ? shapeOf(value[0]) : "empty"}>`;
  if (typeof value === "object") return `{${Object.keys(value).sort().join(",")}}`;
  return typeof value;
}

try {
  await client.connect();
} catch (error) {
  console.error(`无法取证：连不上 ${new URL(databaseUrl).host} —— ${error.message}`);
  console.error("（本机 5432 无监听，Postgres 后端未在运行；这不是「没有旧数据」。）");
  process.exit(2);
}

try {
  const exists = await client.query(
    "SELECT to_regclass('public.sitecraft_sites') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) {
    console.log("连上了，但 public.sitecraft_sites 不存在 —— 该库从未建表，存量数据为空。");
    process.exit(0);
  }

  const { rows } = await client.query(
    "SELECT site_id, history, future FROM sitecraft_sites",
  );

  const opCounts = new Map();
  const legacyShapes = new Map();
  const sectionCounts = new Map();
  const sourceCounts = new Map();
  const cardPrefixed = new Map();
  let changeSets = 0;
  let forwardOps = 0;
  let inverseOps = 0;
  let legacyForward = 0;
  let legacyInverse = 0;
  const sitesWithLegacy = new Set();
  let legacyFilesForward = 0;
  const sitesWithLegacyForward = new Set();

  const scan = (operation, where, siteId) => {
    if (!operation || typeof operation !== "object") return;
    bump(opCounts, `${where}:${String(operation.op)}`);
    if (LEGACY_OPS.has(operation.op)) {
      if (where === "forward") { legacyForward += 1; sitesWithLegacyForward.add(siteId); }
      else legacyInverse += 1;
      bump(legacyShapes, `${operation.op} ${shapeOf(operation)}`);
      if (typeof operation.section === "string") bump(sectionCounts, `${operation.op} section=${operation.section}`);
      if (typeof operation.itemId === "string") bump(sectionCounts, `${operation.op} 带 itemId`);
      sitesWithLegacy.add(siteId);
    }
  };
  const scanStrings = (value, trace, depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.startsWith("card:")) bump(cardPrefixed, `${trace} = card:<...>`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scanStrings(entry, `${trace}[${index}]`, depth + 1));
      return;
    }
    if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (key === "op" || key === "operations" || key === "inverseOperations") continue;
        scanStrings(entry, trace ? `${trace}.${key}` : key, depth + 1);
      }
    }
  };

  for (const row of rows) {
    const history = Array.isArray(row.history) ? row.history : [];
    const future = Array.isArray(row.future) ? row.future : [];
    for (const changeSet of [...history, ...future]) {
      changeSets += 1;
      if (typeof changeSet?.source === "string") bump(sourceCounts, changeSet.source);
      for (const operation of changeSet?.operations ?? []) {
        forwardOps += 1;
        scan(operation, "forward", row.site_id);
        scanStrings(operation, "");
      }
      for (const operation of changeSet?.inverseOperations ?? []) {
        inverseOps += 1;
        scan(operation, "inverse", row.site_id);
        scanStrings(operation, "");
      }
    }
  }

  const dump = (title, map, limit = 40) => {
    console.log(`\n## ${title}`);
    if (!map.size) { console.log("  （无）"); return; }
    for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      console.log(`  ${String(count).padStart(8)}  ${key}`);
    }
  };

  console.log("# 存量落盘 operations 调研（Postgres，只读）");
  console.log(`\n站点行数：${rows.length}`);
  console.log(`ChangeSet 总数：${changeSets}`);
  console.log(`forward operations：${forwardOps} / inverseOperations：${inverseOps}`);
  console.log(`\n**旧名出现次数：forward ${legacyForward} / inverse ${legacyInverse} / 合计 ${legacyForward + legacyInverse}**`);
  console.log(`**含旧名的站点数（forward）：${sitesWithLegacyForward.size}**`);
  console.log(`**含旧名的站点数（forward∪inverse）：${sitesWithLegacy.size}**`);
  dump("op 名频次", opCounts);
  dump("旧 op 字段形态", legacyShapes);
  dump("旧 op 的 section / itemId", sectionCounts);
  dump("ChangeSource 分布", sourceCounts);
  dump("非 op 位置的 card: 前缀串", cardPrefixed);

  // ---- 生成存证（gen）与"两后端是否共享数据" ----
  // 用户裁决要求显著标注"文件与 PG 是两个独立后端、数字互不包含"。
  // 光靠声明不够——这里给出可复算的证据：site_id 重叠度。
  console.log("\n# 生成存证（generation_records）与后端重叠度");
  try {
    const hasGen = await client.query("SELECT to_regclass('public.generation_records') IS NOT NULL AS present");
    if (hasGen.rows[0]?.present) {
      const genTotal = await client.query("SELECT count(*)::int AS c FROM generation_records");
      console.log(`generation_records 行数：${genTotal.rows[0].c}`);
      const genOps = await client.query(
        "SELECT e->>'op' AS op, count(*)::int AS c FROM generation_records g, jsonb_array_elements(g.operations) e GROUP BY 1 ORDER BY 2 DESC",
      );
      console.log("generation_records.operations 里的 op 名（**不是 ChangeSet，是另一次生成尝试的存证**）：");
      for (const row of genOps.rows) console.log(`  ${String(row.c).padStart(8)}  ${row.op}`);
      const genLegacy = genOps.rows.filter((row) => LEGACY_OPS.has(row.op)).reduce((sum, row) => sum + row.c, 0);
      console.log(`  → 其中旧名：${genLegacy}`);
      const provCount = await client.query("SELECT count(*)::int AS c FROM generation_records WHERE provenance IS NOT NULL");
      console.log(`  含 provenance 的行：${provCount.rows[0].c}`);
      console.log("  ⚠️ 本脚本的「旧名出现次数」**不含** generation_records —— 只统计 ChangeSet。");
    } else {
      console.log("generation_records 表不存在。");
    }
  } catch (error) {
    console.log(`生成存证查询失败（不影响 ChangeSet 口径）：${error.message}`);
  }

  try {
    const { readdir } = await import("node:fs/promises");
    const fileIds = new Set(
      (await readdir(path.join(process.cwd(), ".sitecraft-data", "sites")))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.replace(/\.json$/, "")),
    );
    const pgIds = new Set(rows.map((row) => row.site_id));
    let overlap = 0;
    for (const id of fileIds) if (pgIds.has(id)) overlap += 1;
    console.log("\n## 两个后端是独立数据（不是同一批东西的两份）");
    console.log(`  PG site_id 数：${pgIds.size}`);
    console.log(`  文件 site_id 数：${fileIds.size}`);
    console.log(`  **重叠数：${overlap}**（仅 ${((overlap / fileIds.size) * 100).toFixed(1)}% 的文件站点在 PG 里也有）`);
    console.log(`  PG 独有：${pgIds.size - overlap}；文件独有：${fileIds.size - overlap}`);
    console.log("  → 因此本报告的 PG 数字与文件后端数字**互不包含、不可相加**。");
  } catch (error) {
    console.log(`重叠度统计失败：${error.message}`);
  }
} finally {
  await client.end().catch(() => undefined);
}
