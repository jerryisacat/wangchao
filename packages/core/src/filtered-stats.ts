// Issue #184 (Plan Task 4.5) — SPEC §4.2「低价值信息已过滤」+ §5.8 Dashboard 输出。
//
// 设计：
// - 纯计算模块，不依赖 DB。DB 层把 Item 行映射成 FilteredItemInput 后调用。
// - reason 来自 Item.rawMetadata.filteredReason（worker analysis.ts 已写入）。
// - 输出 summary 同时供 Briefing.metadata.snapshot 与渲染层复用。

import { UNSPECIFIED_REASON } from "./business-window.js";

export interface FilteredItemInput {
  /** Item.status，仅 "FILTERED" 计入。 */
  status: "FETCHED" | "FILTERED" | "ANALYZED" | "DUPLICATE" | "ERROR" | string;
  /** Item.rawMetadata.filteredReason；可能为 undefined/空。 */
  filteredReason?: string | null;
}

export interface FilteredStatsSummary {
  count: number;
  /** reason -> 数量。缺失/空 reason 归入 "unspecified"。 */
  byReason: Record<string, number>;
}

/**
 * 聚合一个业务窗口内的 FILTERED item 统计。
 * 非 FILTERED status 被忽略（它们不算「低价值已过滤」）。
 */
export function summarizeFilteredStats(items: ReadonlyArray<FilteredItemInput>): FilteredStatsSummary {
  const byReason: Record<string, number> = {};
  let count = 0;
  for (const item of items) {
    if (item.status !== "FILTERED") continue;
    count += 1;
    const reason = normalizeReason(item.filteredReason);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { byReason, count };
}

/**
 * 渲染「四、低价值信息已过滤」分区 Markdown。
 * count=0 时返回空串（调用方据此省略分区），避免空噪音。
 * 输出 zh-CN，与 render-briefing.ts 保持一致。
 */
export function renderFilteredStatsSection(summary: FilteredStatsSummary): string {
  if (summary.count === 0) return "";
  const lines: string[] = [
    `低价值信息已过滤 ${summary.count} 条`,
  ];
  // 按 reason 数量降序、reason 字典序兜底，保证输出稳定。
  const reasons = Object.entries(summary.byReason).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  for (const [reason, n] of reasons) {
    lines.push(`- ${reason}: ${n}`);
  }
  return lines.join("\n") + "\n";
}

function normalizeReason(reason: string | null | undefined): string {
  if (reason == null) return UNSPECIFIED_REASON;
  const trimmed = reason.trim();
  return trimmed === "" ? UNSPECIFIED_REASON : reason;
}