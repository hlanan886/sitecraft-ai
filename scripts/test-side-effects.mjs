/**
 * 跑一遍全套测试，并比对跑前跑后的**副作用签名**。
 *
 * 签名由 `tests/test-side-effects.test.ts` 打印（各数据目录的条目数）。
 * 退出码：0 = 签名一致（测试没写脏真实目录）；1 = 有增长（有副作用）。
 *
 * 为什么单独一个脚本而不是塞进 `npm test`：它要跑**两遍**签名 + 一遍全套，
 * 日常开发不该为它变慢。CI 里应该跑它。
 */
import { spawnSync } from "node:child_process";

const NODE = process.execPath;
const SIGNATURE_FILE = "tests/test-side-effects.test.ts";

function signature() {
  const result = spawnSync(NODE, ["--test", "--experimental-strip-types", SIGNATURE_FILE], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const line = String(result.stdout).split("\n").find((l) => l.includes("SIDE-EFFECT-SIGNATURE|"));
  if (!line) throw new Error("拿不到副作用签名——测试文件没输出？\n" + String(result.stdout).slice(-500));
  return line.slice(line.indexOf("SIDE-EFFECT-SIGNATURE|"));
}

console.log("① 跑前签名…");
const before = signature();
console.log("   " + before);

console.log("② 跑全套测试…");
const suite = spawnSync("npm", ["test"], { stdio: "inherit", shell: true, cwd: process.cwd() });

console.log("③ 跑后签名…");
const after = signature();
console.log("   " + after);

if (before !== after) {
  console.error("\n✖ 副作用守卫：测试向数据目录写入了东西");
  const parse = (s) => Object.fromEntries(s.replace("SIDE-EFFECT-SIGNATURE|", "").split("|").map((p) => p.split("=")));
  const b = parse(before);
  const a = parse(after);
  for (const key of Object.keys(b)) {
    if (b[key] !== a[key]) console.error(`   ${key}: ${b[key]} → ${a[key]}（+${a[key] - b[key]}）`);
  }
  process.exit(1);
}
if (suite.status !== 0) {
  console.error(`\n✖ 全套测试本身没过（退出码 ${suite.status}）`);
  process.exit(suite.status ?? 1);
}
console.log("\n✔ 副作用守卫：跑前跑后签名一致，测试没有污染数据目录");
