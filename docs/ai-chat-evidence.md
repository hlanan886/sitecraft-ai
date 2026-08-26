# AI 对话实测证据（阶段A-2）

- 日期：2026-08-26
- 环境：生产模式 + PostgreSQL + DeepSeek deepseek-v4-flash
- 基线：revision 1（Forge Industrial 默认草稿）


### 场景 1：卡片定位-第二个服务

指令：`只把第二个服务标题改为智能产线集成，其他内容不变`

**HTTP**: 200 | **status**: applied | **revision**: 4

**summary**: 更新第二个服务标题为智能产线集成

**operations**:

```json
[
  {
    "op": "update_card",
    "section": "services",
    "index": 1,
    "locale": "zh",
    "title": "智能产线集成"
  }
]
```

**appliedTargets**: `["services.items.1.title.zh"]`

### 场景 2：单模块多字段-首屏

指令：`把首屏标题改成'可靠制造，从关键部件开始'，说明改短`

**HTTP**: 200 | **status**: applied | **revision**: 5

**summary**: 更新中文首屏标题与副标题

**operations**:

```json
[
  {
    "op": "set_text",
    "target": "hero.title",
    "locale": "zh",
    "value": "可靠制造，从关键部件开始"
  },
  {
    "op": "set_text",
    "target": "hero.subtitle",
    "locale": "zh",
    "value": "从关键部件到整线交付，稳定可靠。"
  }
]
```

**appliedTargets**: `["hero.title.zh","hero.subtitle.zh"]`

### 场景 3：定位+改写-第三个优势

指令：`把第三个核心优势的说明改短一点`

**HTTP**: 200 | **status**: applied | **revision**: 6

**summary**: 缩短第三个核心优势的说明

**operations**:

```json
[
  {
    "op": "update_card",
    "section": "features",
    "index": 2,
    "locale": "zh",
    "body": "询价、打样与项目沟通，一个入口。"
  }
]
```

**appliedTargets**: `["features.items.2.body.zh"]`

### 场景 4：商品按SKU定位

指令：`把 FM-2401 这个产品的英文简介改一下`

**HTTP**: 200 | **status**: applied | **revision**: 7

**summary**: 更新 FM-2401 英文简介

**operations**:

```json
[
  {
    "op": "update_product",
    "sku": "FM-2401",
    "locale": "en",
    "summary": "High-precision module engineered for reliable performance on continuous production lines."
  }
]
```

**appliedTargets**: `["products.FM-2401.summary.en"]`

### 场景 5：多轮记忆-改短一点

指令：刚才改的标题再改短一点

**结果：无 done 事件 (HTTP 409)**

### 场景 6：复杂多目标

指令：`公司名改成华辰精工，导航'关于'改成'关于华辰'，邮箱改 info@huachen.com`

**HTTP**: 200 | **status**: applied | **revision**: 8

**summary**: 将公司名改为华辰精工，导航“关于”改为“关于华辰”，邮箱改为 info@huachen.com

**operations**:

```json
[
  {
    "op": "set_text",
    "target": "companyName",
    "locale": "zh",
    "value": "华辰精工"
  },
  {
    "op": "set_text",
    "target": "navigation.about",
    "locale": "zh",
    "value": "关于华辰"
  },
  {
    "op": "set_text",
    "target": "contact.email",
    "locale": "zh",
    "value": "info@huachen.com"
  }
]
```

**appliedTargets**: `["companyName.zh","navigation.about.zh","contact.email.zh"]`

### 场景 7a：明确要求换模板

指令：`请把模板换成 atlas`

**HTTP**: 200 | **status**: no_change | **revision**: 8

**summary**: 将当前模板切换为 atlas

**operations**:

```json
[]
```

**appliedTargets**: `[]`

**rejected**: `["用户没有明确要求更换模板，已拒绝模板切换"]`

### 场景 7b：未明确要求换模板

指令：`把首屏优化一下，别换模板`

**HTTP**: 200 | **status**: applied | **revision**: 9

**summary**: 优化首屏文案，突出精密部件与整线交付能力

**operations**:

```json
[
  {
    "op": "set_text",
    "target": "hero.title",
    "locale": "zh",
    "value": "精密制造，从部件到整线"
  },
  {
    "op": "set_text",
    "target": "hero.title",
    "locale": "en",
    "value": "Precision manufacturing, from components to full lines"
  },
  {
    "op": "set_text",
    "target": "hero.subtitle",
    "locale": "zh",
    "value": "覆盖高精度模块、复合材料组件与智能检测单元，为连续产线提供质量保障与稳定交付。"
  },
  {
    "op": "set_text",
    "target": "hero.subtitle",
    "locale": "en",
    "value": "From precision modules to composite assemblies and smart inspection units, we deliver quality and reliable supply for continuous production lines."
  },
  {
    "op": "set_text",
    "target": "hero.cta",
    "locale": "zh",
    "value": "查看产品与能力"
  },
  {
    "op": "set_text",
    "target": "hero.cta",
    "locale": "en",
    "value": "View products & capabilities"
  }
]
```

**appliedTargets**: `["hero.title.zh","hero.title.en","hero.subtitle.zh","hero.subtitle.en","hero.cta.zh","hero.cta.en"]`

---

# 阶段 B 修复 + 阶段 C 验收记录

## 修复项（R1/R2/R3）

| 项 | 问题（实测证据） | 修复 | 改动文件 |
|---|---|---|---|
| R1 | 模板切换正则只匹配"换模板"语序，"模板换成"被误拒（场景7a） | 正则支持两类语序（动词在前 + 名词在前）+ 英文双向 | `lib/site-operations.ts` |
| R2 | 多轮无记忆，"刚才改的标题再改短一点" HTTP 409（场景5） | 前端透传最近3轮对话为 context，服务端拼入 prompt | `app/workspace/page.tsx`、`app/api/sites/[siteId]/chat/route.ts`、`lib/ai-provider.ts` |
| R3 | 首屏副标题 40+ 字偏长（场景7b） | prompt 加文案简短约束（标题≤15字/说明≤40字） | `lib/ai-provider.ts` |

## 阶段C 验收（改后重跑对比）

- 环境：生产模式 + PostgreSQL + deepseek-v4-flash，feat/ai-chat-improve 分支

### 门禁结果
- `npm test`：7/7 通过（含 2 个新增回归：模板换成语序、英文 switch template 语序）
- `npm run typecheck`：无错误
- `git diff --check`：exit 0
- `npm run test:three-sites`：三站全过（nova-motion-ai forge/6条、harborlink-global-ai atlas/6条、axiomflow-cloud-ai kindred/7条），全部 model-backed + done.model 存在

### 修复验证（改前 vs 改后）
| 验证点 | 改前 | 改后 |
|---|---|---|
| R1 "请把模板换成 atlas" | rejected（误拒） | applied，成功切到 atlas，切回 forge 也正常 |
| R2 "刚才改的标题再改短一点" | HTTP 409 崩溃 | 带 context 正确识别"刚才"指代第1轮改的"智能产线集成"，缩短为"产线集成"，HTTP 200 |
| R3 首屏文案长度 | 副标题 40+ 字 | 中文标题 9 字、副标题 28 字 |

