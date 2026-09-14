# screwfast 原生版 · 验收清单（用户检查用）

> 本次成果：screwfast 模板用鑫力内容渲染，**features 走原生 icon 行而非白卡片墙**；登录/评分/定价 demo 残留已清；hero 主图已换为工业场景。这是"扩展其它模板"前的验收基线。
> 对照图：`成品展示/惠州鑫力-hero换工业图-首屏.png`、`-整页.png`

## ✅ 已解决（Codex 视觉复审 3 轮确认）
| 问题 | 处置 |
|---|---|
| 卡片 AI 味：features/services/about 全白卡片墙 | features 改走**模板原生 icon 行**（自建模具车间/尺寸稳定/材料可溯/来图打样），图标留模板 svg |
| 登录/注册/评分残留（Log in、4.8/5 From Over 12.8k Reviews） | 已从页面删除（DOM 断言验证） |
| Blog/Terms/多语言切换 demo 导航 | 已删，导航只剩中文（首页/产品中心/服务能力/联系我们） |
| 模板内置可复用版式没用上 | FeaturesGeneral（图横幅+左标题栏+右 icon 行）被**保留复用**，不再删光 |
| hero 主图是包装盒渲染（偏电商） | 已换为模板自带 `construction-image`（厂房/设备工业场景） |

## ⚠️ 已知问题（素材/取舍，需你决策）
1. **hero 图行业指向略偏**：换的钢构厂房更像"建筑工程"，不是"精密冲压螺丝"。模板素材里**没有冲压设备特写**——若要有，需外部提供产线/设备实拍图（不建议凭空 AI 生图）。
2. **"螺/丝"跨行**：hero 标题断行不自然，可调字号/宽度。
3. **胶囊导航/暗色按钮/语言下拉**：screwfast 模板自身视觉 DNA，按"围绕模板不硬改"原则保留；若你觉得仍偏 SaaS 气质可再议。

## 🔬 代码级验收（可复跑）
```
node scripts/verify-native-render.mjs   # DOM 断言：features 原生 icon 行、无卡片墙、无登录残留
node scripts/visual-review.mjs          # 截图 hero/features/full 供 Codex 视觉复审
npm test                                # 295 单测
```

## 技术改动清单（12 文件，供 Codex/老大对照）
- `lib/template-manifests/types.ts` + `shared.ts`：新增 `presentation`（每槽原生排版角色/容量）+ `defaultPresentation` 兜底
- `lib/template-manifests/screwfast.ts`：screwfast presentation 档案
- `lib/template-manifest.ts`：`getTemplatePresentation()` 存取
- `lib/template-adapters/screwfast.ts`：prepareFn 删光→**保留原生区**；nativeFillFn 填原生 icon 行；清 demo 残留
- `lib/template-adapters/types.ts`：adapter 加 `nativeFillFn` 通道
- `app/api/templates/[templateId]/preview/route.ts`：nativeFillFn 注入+调用；防产品名误写原生区
- `lib/template-slot-guard.ts`：capability 带 presentation 摘要
- `lib/ai-provider.ts` / `lib/ai-self-eval.ts`：GPT 双 provider
- `lib/site-generator.ts`：batchBHint 去"前3张卡片"硬编码，改读模板容量
- `lib/site-intent.ts`：模板匹配提示词加"结构+适合行业/公司"
- `scripts/visual-review.mjs`、`scripts/verify-native-render.mjs`：验收工具

## 扩展其它模板（你验收后）
把 screwfast 这套"保留原生区 + nativeFill + presentation 档案"套用到 forge/atlas/powerai/signal/moon，每个模板先做 DOM 断言 + Codex 视觉复审再算完成。
