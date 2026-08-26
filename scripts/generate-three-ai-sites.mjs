const origin = process.env.SITECRAFT_ORIGIN || "http://127.0.0.1:3000";

const sites = [
  {
    id: "nova-motion-ai",
    templateId: "forge",
    facts: "诺瓦精密传动（苏州）有限公司，测试品牌 Nova Motion。面向机器人、半导体设备和自动化产线，提供精密减速机、旋转执行器与定制传动总成。联系邮箱 sales@novamotion.example，电话 +86 512 5550 2188，测试地址为苏州工业园区星湖街 88 号。",
    productDirection: "把三个现有 SKU 分别定位为精密减速机、旋转执行器、定制传动总成。",
  },
  {
    id: "harborlink-global-ai",
    templateId: "atlas",
    facts: "海联环球工业品有限公司，测试品牌 HarborLink Global。位于宁波，为欧洲和东南亚 B2B 采购商提供工业泵、控制阀和密封组件的产品整合、供应商审核、出口文件与交付协调。联系邮箱 inquiry@harborlink.example，电话 +86 574 5556 9030，测试地址为宁波市鄞州区航运路 26 号。",
    productDirection: "把三个现有 SKU 分别定位为耐腐蚀工业泵、过程控制阀、工业密封组件。",
  },
  {
    id: "axiomflow-cloud-ai",
    templateId: "kindred",
    facts: "矩流数据科技有限公司，测试品牌 AxiomFlow。为制造企业提供云端生产数据平台，能力包括设备数据连接、质量规则引擎、异常协同和管理看板；不提供任何未经验证的客户数量、节省比例或认证数据。联系邮箱 demo@axiomflow.example，电话 400-800-2618，测试地址为上海市浦东新区科创路 120 号。",
    productDirection: "把三个现有 SKU 分别定位为设备连接网关、质量规则引擎、生产运营看板。",
  },
];

function events(raw) {
  return raw
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((value) => JSON.parse(value));
}

async function snapshot(siteId) {
  const response = await fetch(`${origin}/api/sites/${siteId}/draft`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${siteId}: draft HTTP ${response.status}`);
  return response.json();
}

async function selectTemplate(site) {
  const current = await snapshot(site.id);
  if (current.draft.templateId === site.templateId) return current;
  const response = await fetch(`${origin}/api/sites/${site.id}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseRevision: current.draft.revision,
      operations: [{ op: "set_template", templateId: site.templateId }],
      summary: `三站真实 AI 测试：选择 ${site.templateId} 模板`,
      source: "template",
    }),
  });
  if (!response.ok) throw new Error(`${site.id}: template HTTP ${response.status}`);
  return response.json();
}

async function ask(siteId, message) {
  const current = await snapshot(siteId);
  const response = await fetch(`${origin}/api/sites/${siteId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision: current.draft.revision, message, selectedTarget: null }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${siteId}: chat HTTP ${response.status} ${raw.slice(0, 300)}`);
  const done = events(raw).findLast((item) => item.type === "done");
  if (!done) throw new Error(`${siteId}: DeepSeek did not return a completion event`);
  if (!['applied', 'no_change'].includes(done.status)) throw new Error(`${siteId}: ${done.error || done.status}`);
  if (!done.model) throw new Error(`${siteId}: response did not identify a real model`);
  return { status: done.status, revision: done.draft?.revision, model: done.model, summary: done.summary, latencyMs: done.latencyMs };
}

for (const site of sites) {
  const prepared = await selectTemplate(site);
  const common = `这是三站验收使用的测试企业资料，可以作为本测试网站的事实来源：${site.facts} 不得虚构客户、认证、市场份额、经营年限或量化业绩；缺失信息写待补充；保留当前开源模板。`;
  const results = [];
  const completedChanges = prepared.history.filter((item) => item.source === "ai" && item.model);
  if (completedChanges.length < 6) {
    results.push(await ask(site.id, `${common}\n先由你完成中文品牌基础：更新站点名、公司名、行业、网站目标、五个导航名称、中文首屏标题/说明/CTA、中文关于标题和正文。文案应适合该行业，不要机械复述资料。`));
    results.push(await ask(site.id, `${common}\n继续完成中文能力内容：写核心优势标题和说明并改写三个优势卡片；写服务标题和说明并改写三个服务卡片。只完成这些字段。`));
    results.push(await ask(site.id, `${common}\n继续完成中文产品与联系内容：写产品区标题和说明；写联系标题、说明、邮箱、电话和中文地址。${site.productDirection} 为三个现有 SKU 生成中文名称、中文摘要和准确类别。只完成这些字段。`));
    results.push(await ask(site.id, `${common}\n在不改动中文的前提下，生成英文品牌页面基础：英文五个导航、英文首屏标题/说明/CTA、英文关于标题和正文。英文要面向国际 B2B 访客自然本地化。`));
    results.push(await ask(site.id, `${common}\n在不改动中文的前提下，生成英文能力内容：英文核心优势标题/说明及三个优势卡片；英文服务标题/说明及三个服务卡片。只完成这些字段。`));
    results.push(await ask(site.id, `${common}\n在不改动中文和模板的前提下，补齐英文产品与联系内容：英文产品区标题/说明、英文联系标题/说明/地址，并为三个现有 SKU 生成英文名称和英文摘要。`));
  }
  const final = await snapshot(site.id);
  const realAIChanges = final.history.filter((item) => item.source === "ai" && item.model);
  if (realAIChanges.length < 6) throw new Error(`${site.id}: expected 6 model-backed changes, got ${realAIChanges.length}`);
  console.log(JSON.stringify({
    siteId: site.id,
    url: `${origin}/published/${site.id}`,
    templateId: final.draft.templateId,
    revision: final.draft.revision,
    companyName: final.draft.companyName,
    heroZh: final.draft.content.hero.title.zh,
    heroEn: final.draft.content.hero.title.en,
    modelChanges: realAIChanges.length,
    calls: results,
  }));
}
