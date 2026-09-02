// 阶段A-2 场景实测脚本：跑 7 个典型对话场景，记录 AI 行为证据
// 用法: node --experimental-strip-types scripts/run-chat-scenarios.mjs
// 读取 .env 从环境变量；输出 markdown 证据到 docs/ai-chat-evidence.md

const BASE = "http://localhost:3000";
const SITE = "demo";

async function getDraft() {
  const res = await fetch(`${BASE}/api/sites/${SITE}/draft`, { cache: "no-store" });
  return res.json();
}

async function postChat(message, baseRevision, selectedTarget = null) {
  const res = await fetch(`${BASE}/api/sites/${SITE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, message, selectedTarget }),
  });
  const text = await res.text();
  const events = text
    .split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((v) => {
      try { return JSON.parse(v); } catch { return null; }
    })
    .filter(Boolean);
  const done = events.find((e) => e.type === "done");
  return { httpStatus: res.status, events, done };
}

async function main() {
  const scenarios = [
    { id: 1, label: "卡片定位-第二个服务", msg: "只把第二个服务标题改为智能产线集成，其他内容不变" },
    { id: 2, label: "单模块多字段-首屏", msg: "把首屏标题改成'可靠制造，从关键部件开始'，说明改短" },
    { id: 3, label: "定位+改写-第三个优势", msg: "把第三个核心优势的说明改短一点" },
    { id: 4, label: "商品按SKU定位", msg: "把 FM-2401 这个产品的英文简介改一下" },
    { id: 5, label: "多轮记忆-改短一点", msg: "刚才改的标题再改短一点", dependsOn: 1 },
    { id: 6, label: "复杂多目标", msg: "公司名改成华辰精工，导航'关于'改成'关于华辰'，邮箱改 info@huachen.com" },
    { id: "7a", label: "明确要求换模板", msg: "请把模板换成 atlas" },
    { id: "7b", label: "未明确要求换模板", msg: "把首屏优化一下，别换模板" },
  ];

  const lines = [];
  const revByScenario = {};

  for (const s of scenarios) {
    // 计算 baseRevision：依赖场景用其 revision，否则用当前最新
    let baseRevision = revByScenario[s.dependsOn] ?? (await getDraft()).draft.revision;
    if (!s.dependsOn) {
      baseRevision = (await getDraft()).draft.revision;
    }
    process.stdout.write(`[场景${s.id}] ${s.label}... `);
    const { httpStatus, done } = await postChat(s.msg, baseRevision);
    if (!done) {
      process.stdout.write(`无 done 事件 (HTTP ${httpStatus})\n`);
      lines.push(`\n### 场景 ${s.id}：${s.label}\n\n指令：${s.msg}\n\n**结果：无 done 事件 (HTTP ${httpStatus})**`);
      continue;
    }
    const ops = done.operations || done.changeSet?.operations || [];
    const applied = done.changeSet?.appliedTargets || [];
    const rev = done.draft?.revision;
    revByScenario[s.id] = rev;
    process.stdout.write(`status=${done.status} rev=${rev} ops=${ops.length}\n`);
    lines.push(`\n### 场景 ${s.id}：${s.label}\n\n指令：\`${s.msg}\`\n\n**HTTP**: ${httpStatus} | **status**: ${done.status} | **revision**: ${rev}\n\n**summary**: ${done.summary ?? done.error ?? "(无)"}\n\n**operations**:\n\n\`\`\`json\n${JSON.stringify(ops, null, 2)}\n\`\`\`\n\n**appliedTargets**: \`${JSON.stringify(applied)}\``);
    if (done.rejected?.length) lines.push(`\n**rejected**: \`${JSON.stringify(done.rejected)}\``);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const md = `# AI 对话实测证据（阶段A-2）\n\n- 日期：2026-08-26\n- 环境：生产模式 + PostgreSQL + DeepSeek deepseek-v4-flash\n- 基线：revision 1（Forge Industrial 默认草稿）\n\n${lines.join("\n")}\n`;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("docs", { recursive: true });
  await writeFile("docs/ai-chat-evidence.md", md, "utf8");
  console.log("\n证据已写入 docs/ai-chat-evidence.md");
}

main().catch((e) => { console.error("脚本失败:", e); process.exit(1); });
