import assert from "node:assert/strict";
import test from "node:test";

import { cloneDraft, defaultDraft } from "../lib/site-document.ts";
import { PRODUCT_COLUMN_ALIASES, importProductsFromRows, sampleProductCsv } from "../lib/site-model.ts";

/**
 * T-26 · 内置样例商品表格（2026-09-14）
 *
 * ## 这个测试要防的事（军规 1「禁止手抄」的可执行形态）
 *
 * 样例表格的表头**必须**与解析器认识的列名是同源派生，否则会漂移成**坏样本**：
 * 解析器改了别名而样例没改（或反过来），用户下载样例、照它填、再导入——**全部报错**，
 * 而他没有任何线索知道是样例错了还是自己填错了。
 *
 * 所以本文件的核心不是"表头等于某个字符串"，而是：
 * **改动 `PRODUCT_COLUMN_ALIASES` 后，本文件必须立刻红。**
 * 若把样例表头换成任何一份手抄的字面量，这条性质就没了——那正是要拒绝的实现。
 *
 * ## 判据为何用 `imported` 而不是数表头列
 *
 * `importProductsFromRows` 的 `imported += 1` 只在 **sku 与 name 都解析出非空值**时发生
 * （lib/site-model.ts 的缺字段分支 `return` 在它之前）。所以
 * 「样例表头每一列都被识别」可判定为 **回环导入后 `imported === 1` 且 `errors` 为空**——
 * 不需要在测试里再抄一份列名清单（抄了就又是第二份真相，同一个坑换个地方踩）。
 */

/** 极简 CSV 解析：本测试的样例是我们自己生成的两行、无引号转义，够用即可。 */
function parseCsvLine(line: string): string[] {
  return line.split(",");
}

/** 样例当前的数据行（现取，理由同 `sampleHeaders`）。 */
function sampleDataLines(): string[] {
  return sampleProductCsv.split("\n").slice(1);
}

/** 表头→单元格 的映射；`headers` 每次现取，避免被别名表改动后的旧值粘住。 */
function rowsFrom(sourceLines: string[], sourceHeaders: string[]): Record<string, string>[] {
  return sourceLines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(sourceHeaders.map((header, index) => [header, cells[index] ?? ""]));
  });
}

/** 样例当前的表头（现取：别名表改了、样例跟着改了，读到的就是新的）。 */
function sampleHeaders(): string[] {
  return parseCsvLine(sampleProductCsv.split("\n")[0]);
}

test("样例表头每一列都能被 importProductsFromRows 识别（列名漂移即红）", () => {
  const headers = sampleHeaders();
  const result = importProductsFromRows(cloneDraft(defaultDraft), rowsFrom(sampleDataLines(), sampleHeaders()));
  assert.equal(result.errors.length, 0, `样例自身产生了导入错误：${result.errors.join("；")}`);
  assert.equal(result.imported, sampleDataLines().length, "样例数据行应全部导入成功——有行被拒说明列名没被识别");
  assert.equal(result.products.length, sampleDataLines().length);
});

test("样例表头与别名表同源：每一个表头都出现在某列的别名里", () => {
  // ⚠️ 显式 Set<string>：PRODUCT_COLUMN_ALIASES 是 `as const`，字面量联合会让 has() 只收窄类型，
  //    而这里查的是**运行期读到的任意表头**（拼错一个中文列名不该是 tsc 错误，而应是这条断言红）。
  const known = new Set<string>(Object.values(PRODUCT_COLUMN_ALIASES).flatMap((aliases) => [...aliases]));
  const unknown = sampleHeaders().filter((header) => !known.has(header.trim().toLowerCase()));
  assert.deepEqual(unknown, [], `样例里有解析器不认识的列：${unknown.join("、")}`);
});

test("样例表头覆盖 sku / name / 分类 / 图片四类关键列", () => {
  const present = new Set(sampleHeaders().map((header) => header.trim().toLowerCase()));
  for (const key of ["sku", "name", "category", "image"] as const) {
    const matched = PRODUCT_COLUMN_ALIASES[key].some((alias) => present.has(alias));
    assert.ok(matched, `样例缺少「${key}」列（接受写法：${PRODUCT_COLUMN_ALIASES[key].join(" / ")}）`);
  }
});

test("样例数据行的列数与表头一致（加了列没补数据就会错位）", () => {
  const width = sampleHeaders().length;
  for (const line of sampleDataLines()) {
    assert.equal(parseCsvLine(line).length, width, `数据行列数应等于表头列数 ${width}`);
  }
});

test("别名值不得含逗号（它会经 join(\",\") 变成表头，逗号会凭空多出一列）", () => {
  const offenders = Object.entries(PRODUCT_COLUMN_ALIASES).flatMap(([key, aliases]) =>
    [...aliases].filter((alias) => alias.includes(",")).map((alias) => `${key}: ${alias}`));
  assert.deepEqual(offenders, [], "含逗号的别名会把样例表头切错列");
});

test("负向验证：别名表不认识这个表头时，样例立刻变成坏样本", () => {
  /**
   * 这条是**本文件的存在理由**，不是补充用例（附则 A1：先证明实验有分辨力）。
   *
   * 做法：把样例表头换成一个**别名表里绝对没有**的列名，模拟
   * "解析器改了别名、样例没跟着改" 那一刻的状态。
   *
   * ⚠️ 不要把"漂移值"写成某个具体中文（如把「产品名称」改成「商品名」）——
   * 那种写法只在**当前**别名表下是漂移的；一旦别名表将来**加了**那个词，
   * 这条负向验证会**静默失效**（变成永远绿）。所以这里用 `PRODUCT_COLUMN_ALIASES`
   * 现算一个不可能被识别的值：给每个别名加后缀。
   *
   * ⚠️ 判据落 **products 数量**，不落 `imported` / `errors`：
   * 实测漂移后 `imported === 1`、`errors === []`、而 `products.length === 0`
   * ——导入函数会"成功"地什么都不导入。用 imported 当判据 = 假门禁。
   */
  const known = new Set<string>(Object.values(PRODUCT_COLUMN_ALIASES).flatMap((aliases) => [...aliases]));
  const drift = (header: string) => `${header}-x`;
  const driftedHeaders = sampleHeaders().map((header) => (known.has(header.trim().toLowerCase()) ? drift(header) : header));
  const drifted = importProductsFromRows(cloneDraft(defaultDraft), rowsFrom(sampleDataLines(), driftedHeaders));
  assert.equal(drifted.products.length, 0, "别名表不认的表头不该还能导入出商品");

  // 反向确认：换回别名表里的**等价**写法后导入立刻恢复——证明红的是列名而非数据。
  const restoredHeaders = driftedHeaders.map((header) => (header.endsWith("-x") ? header.slice(0, -2) : header));
  const restored = importProductsFromRows(cloneDraft(defaultDraft), rowsFrom(sampleDataLines(), restoredHeaders));
  assert.equal(restored.products.length, sampleDataLines().length, "换回别名写法后应恢复导入");
});
