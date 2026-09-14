"use client";

/**
 * 「重生成此板块」——B6 · 板块级再生成露出。
 *
 * ## 它出现的时机
 *
 * 用户在预览里**点选了某个板块内的元素**（`selectedTarget` 非空）且该元素能映射到
 * 一个板块（`resolveSection` 返回非空）时出现。
 *
 * ## ⚠️ 为什么把映射函数当 prop 传，而不是在组件里自己判
 *
 * `key → section` 的映射规则**已经在父级有一份**（`app/workspace/page.tsx`
 * 的 `sectionFromTarget`，含 `heroTitle`/`heroSubtitle`/`heroCta` 三个
 * hero 别名与六个板块名）。
 *
 * 如果这里再写一份，"哪些 key 算哪个板块"就有**两处定义**——
 * 这正是附则 2（契约只在**一处**定义）与本项目多次付过代价的坑。
 * 所以组件**不复制规则**：判定交给父级传进来的函数，组件只负责"非空即显示"。
 *
 * ## 能力已存在（本组件不含任何取数/请求逻辑）
 *
 * 局部重生成链路（`regenerateSectionOperations` → `POST /api/sites/[id]/generate`
 * 的 `regenerate` step → SSE 进度）**早已打通**，工作台也已有 `submitRegenerate`。
 * 本组件只做一件事：**把那个入口挪到"用户当下正在看的板块"旁边**。
 *
 * ## 军规 5 显式豁免（用户 2026-09-14 裁决）
 *
 * `app/workspace/page.tsx` 是巨型文件，军规 5 拒收新代码。
 * 本组件构成**显式豁免**：页面侧只增 **1 行 import + 1 行挂载**，
 * **新代码 100% 在本子模块内**。豁免登记在 `docs/glossary.md`。
 * **不得拿这条给别的批次开口子。**
 */
import { Sparkles } from "lucide-react";

type Props = {
  /** 当前选中的预览目标；null = 没选 */
  selectedTarget: { key: string; label: string } | null;
  /**
   * key → 板块名。**由父级传入**（不在此复制映射规则，见文件头）。
   * 返回 "" 表示"这个 key 不属于任何可重生成的板块"。
   */
  resolveSection: (key: string) => string;
  /** 生成中禁用（仍在，只是禁用——语义不混） */
  busy: boolean;
  /** 打开重生成弹窗（父级负责 setRegenerateDialog） */
  onRegenerate: (section: string, label: string) => void;
};

export function RegenerateSectionButton({ selectedTarget, resolveSection, busy, onRegenerate }: Props) {
  if (!selectedTarget) return null;
  const section = resolveSection(selectedTarget.key);
  if (!section) return null;

  return (
    <button
      className="secondary-button"
      disabled={busy}
      onClick={() => onRegenerate(section, selectedTarget.label)}
    >
      <Sparkles size={14} />重生成此板块
    </button>
  );
}
