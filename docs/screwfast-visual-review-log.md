# screwfast 原生渲染 · 视觉复审记录（Codex 选择性复审）

> 原则贯穿：**围绕模型理解开源模板去处理，最终按模板建站，不自建卡片**（AI 味重）。本文件记录"渲染→Codex 视觉复审→修复→回归"每一轮。

## 进程
- 2026-09-04 P0-P5 完成：A 描述层(presentation) / B 注入器原生优先(保留 FeaturesGeneral icon 行而非删光重建) / C 生成层喂模板容量 / GPT 双 provider / 模板匹配提示词。
- DOM 级回归门禁 `scripts/verify-native-render.mjs`：✅ features 走原生 icon 行(自建模具车间/尺寸稳定/材料可溯/来图打样)、无卡片墙、无登录残留。
- `scripts/visual-review.mjs`：渲染 + 截 hero/features/full，交 Codex 视觉复审。

## Codex 复审结论（第 2 轮，评分残留已清后）
1. **首屏仍偏"品牌包装落地页"非"B2B 工厂官网"**：胶囊导航、语言下拉、暗色模式按钮、大留白、包装盒 hero 图。
   - 判定：胶囊导航/暗色按钮/**语言下拉是 screwfast 模板自身视觉 DNA**，非我们的注入引入。按"围绕模板建站、不硬改模板"原则，**不改模板原生控件**；但其中真正"不属于制造官网信任要素"的、模板演示才有而企业站无意义的，按 sanitize 隐藏。
2. **features 原生区截图未露出**（脚本滚动到 section 顶部的图横幅，标题/icon 行在视口外）——脚本缺陷，已修（滚到左栏 h2）。
3. **hero 主视觉 = 包装渲染图，非产线/设备实拍** → 制造业官网第一信号应体现工艺。处置：hero 图替换为模板 dist 自带、更贴工业的图（screwfast 有 construction-image 等），或企业无实拍时用模板 industrial 图，而非凭空 AI 生成。
4. **主标题"螺/丝"跨行** → hero.title 断行不自然，属文案/排版微调。

## 处置决策
- 修复 visual-review.mjs 使 features 区可被 Codex 验收（滚动到标题而非 section 顶）。
- hero 图：复用模板资产换更工业的场景图（asset 级替换，不造卡不造图）。
- 以上完成后再交 Codex 第 3 轮复审。
