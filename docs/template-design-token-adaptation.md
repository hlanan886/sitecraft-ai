# 模板 Design Token 适配说明

## 目标与边界

本项目把开源模板作为结构骨架，AI 只生成站点内容和受控的设计变量，不生成任意 HTML、CSS 或全新复杂布局。设计变量由 `lib/design-variants.ts` 从结构化意图推导，并通过可撤销的 `set_design_tokens` 操作保存到草稿。

当前适配覆盖两条预览链路：

- 本地结构预览：`SiteRenderer` 读取草稿中的颜色、字体气质、圆角和密度。
- 开源模板 iframe：预览桥接脚本把同一组变量注入第三方模板 DOM，并按模板补充有限选择器。

开源模板子模块当前没有本地文件，因此 iframe 链路仍可能依赖官方演示站。官方演示不可达、限流，或 8 秒内没有回传 `sitecraft:applied` 时，工作区会切换到本地结构近似渲染；AI 编辑继续可用，但最终视觉仍以正式模板为准。

## Token 映射

| Token | 草稿值 | 本地结构预览 | iframe 桥接 |
| --- | --- | --- | --- |
| 主色 | `primary` | `--site-primary` | `--sitecraft-primary` |
| 辅色 | `secondary` | `--site-secondary` | `--sitecraft-secondary` |
| 强调色 | `accent` | `--site-accent` | `--sitecraft-accent` |
| 字体气质 | `sans / editorial / technical` | `data-font-style` 选择器 | `--sitecraft-font`，覆盖正文与标题 |
| 圆角 | `sharp / soft / rounded` | `--rs-custom-radius` | `--sitecraft-radius`，覆盖按钮、按钮型链接、卡片和 `article` |
| 密度 | `compact / balanced / spacious` | `--rs-density-scale` | `--sitecraft-section-space`，覆盖主要 section 的上下间距 |

颜色值在 iframe 注入前必须通过六位十六进制校验。字体、圆角和密度只接受枚举值，不允许模型注入任意 CSS。

## 三个代表模板的适配策略

| 模板 | 颜色适配 | 字体适配 | 圆角适配 | 密度适配 | 已知边界 |
| --- | --- | --- | --- | --- | --- |
| `forge` | 标题和主要按钮使用主色；卡片与 `article` 边框使用主色的低透明混合色 | 正文和标题走共享字体变量 | 按钮、按钮型链接、卡片和 `article` 走共享圆角 | 顶层 section 走共享间距 | 选择器按语义和类名匹配，第三方 DOM 改版后可能漏命中 |
| `atlas` | 标题和主要按钮使用主色；badge/tag 使用强调色背景和主色文字 | 正文和标题走共享字体变量 | 同共享规则 | 同共享规则 | badge/tag 依赖类名包含对应关键词；其他装饰色不会被强制覆盖 |
| `signal` | 标题和主要按钮使用强调色；卡片与 `article` 边框使用强调色的低透明混合色 | 正文和标题走共享字体变量 | 同共享规则 | 同共享规则 | 深色模板保留原有背景体系，主色与辅色不会覆盖所有装饰层 |

其他开源模板使用保守的通用策略：标题和主要按钮使用主色，其余视觉尽量保留模板原貌。该策略用于降低广泛 `!important` 覆盖造成的布局和可读性风险。

## 本地结构预览适配

`SiteRenderer` 不依赖第三方 DOM，所有模板共用稳定的语义结构，再通过模板 class 保留不同布局气质：

- 颜色应用到标题、按钮、服务区、产品视觉和强调元素。
- `editorial` 和 `technical` 只调整标题字体族；默认保持无衬线体系。
- 自定义圆角只覆盖按钮、产品项、表单和首屏视觉容器。
- 自定义密度只调整首屏及内容板块上下间距，不改变栅格和内容顺序。
- `canvas` 使用同一套可编辑结构与 token，不承诺自由生成任意布局。

## 验证状态

- 已完成代码路径核对：token schema、推导、可撤销操作、本地渲染、iframe 注入和降级状态均已串通。
- 已有自动化覆盖 `set_design_tokens` 的应用与撤销，以及生成计划写入 design token。
- 生产构建与完整门禁结果记录在 `docs/solutions/20260901-template-preview-generation-ux.md`。
- 按本轮要求未做截图验收，也未对官方演示站 DOM 做逐像素或三档视觉对比。
- 由于开源模板子模块为空，不能声明 16 个第三方模板的 DOM 选择器均已完成视觉验证；工作区降级链路用于覆盖这一外部依赖风险。

## 后续接续条件

若未来需要做 1:1 模板视觉适配，应先固定对应模板版本或补齐本地静态快照，再对每个模板分别验证颜色、字体、圆角、密度及移动端布局。官方演示站的动态 DOM 不应作为唯一验收基线。
