/**
 * 每模板适配模块契约。
 *
 * 渲染管线只有一个共享 preview bridge（app/api/templates/[templateId]/preview/route.ts）。
 * 为了让「每模板只能改自己的适配文件」成立，模板专属逻辑从共享 route 抽到
 * lib/template-adapters/<templateId>.ts：route 只按 templateId 取一个适配器并注入，
 * 模板适配不再改共享渲染文件。
 *
 * servicesFn / designTokenCss 通过 bridgeScript 的模板字面量内插为 iframe 内
 * 同一 IIFE 作用域的源码；sanitize 序列化为规则对象由共享 sanitize 引擎消费。
 */
export type TemplateSanitizeRules = {
  /** 命中后整节隐藏的标题正则源码（不含 /i 边界符） */
  sections?: string[];
  /** 命中后隐藏叶节点的正则源码 */
  leafPatterns?: string[];
};

export type TemplateAdapter = {
  templateId: string;
  /** 在共享槽位扫描前执行的模板级准备逻辑源码。 */
  prepareFn?: string;
  /** 自定义 services 槽位适配函数源码（const arrow，闭包访问共享 helper）；无则通用 applyCards */
  servicesFn?: string;
  /**
   * 自定义原生排版填充函数源码（const arrow，闭包访问共享 helper）。
   * 模板某业务槽以非 card 的原生排版呈现（icon_row/image_banner/split 等）时，
   * 用 nativeFillFn 在该槽的原生区块内定位节点改写，而不是退回通用卡片重建。
   * 通过闭包拿到模板自身注入的定位器（如 findFeaturesSection）与共享的 setText/localize。
   */
  nativeFillFn?: string;
  /**
   * 自定义 hero 标题节点定位器源码（const arrow，返回节点或 null，闭包访问共享 helper）。
   * 默认 findHero() 取可见的 main h1/header h1/h1；模板首屏标题是可见 h2 或非标准结构时，
   * 用 heroFn 指定返回承载首屏标题的节点。例：() => allVisible('.gradient-text.text-6xl')[0]
   */
  heroFn?: string;
  /** published 变体残留 demo 内容的隐藏规则 */
  sanitize?: TemplateSanitizeRules;
  /** designToken 应用后的模板专属 CSS 覆盖；无则引擎用通用默认值 */
  designTokenCss?: string;
};
