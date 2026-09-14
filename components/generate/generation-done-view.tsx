"use client";

/**
 * 「站点内容已生成」终态视图（B5 拆文件 · generate 第五块）。
 *
 * ## 边界
 *
 * 只负责这一屏长什么样——**父级那层 `{step === "done" && (...)}` 不进组件**，
 * 条件渲染留在父级，DOM 嵌套与挂载时机零变化（与 B4 六刀同一约定）。
 *
 * ## 依赖面
 *
 * 全块只读一个符号：`generationDuration`（毫秒，null = 未记录）。
 * 零 setter、零 ref、零回调——是本页 5 块里**最干净的一块**，
 * 因此作为 B5 拆分的第一刀，先验证方法论。
 *
 * ## 纯搬家声明
 *
 * JSX 逐字来自拆分前的 generate 页（该 `{step === "done" && (...)}` 块），
 * 仅做"闭包引用 → props"的机械替换。
 */
type Props = {
  /** 本次生成的耗时（毫秒）；null = 未记录，此时不显示用时那一行 */
  generationDuration: number | null;
};

export function GenerationDoneView({ generationDuration }: Props) {
  return (
    <div className="generate-progress-view">
      <div className="eyebrow">完成</div>
      <h1>站点内容已生成</h1>
      {generationDuration !== null && <p>共用时 {(generationDuration / 1000).toFixed(1)} 秒，正在进入工作台…</p>}
    </div>
  );
}
