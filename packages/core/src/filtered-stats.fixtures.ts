// Issue #184 (Plan Task 4.5): 低价值过滤统计 fixture。
// TDD RED: 在 GREEN 之前必须失败。
//
// 覆盖 SPEC §4.2「低价值信息已过滤 N 条」统计 + §5.8 Dashboard 输出：
// - 空 items -> count 0、byReason 空；
// - 多个 FILTERED item 聚合 count + 按 reason 分组；
// - 非 FILTERED status 不计入；
// - 缺失 filteredReason 归入 "unspecified"；
// - reason 大小写敏感（区分 "LOW_RELEVANCE" 与 "low_relevance"）；
// - snapshot summary 生成人类可读中文摘要行（用于 Briefing UI）。

import {
  summarizeFilteredStats,
  renderFilteredStatsSection,
  type FilteredItemInput,
  type FilteredStatsSummary,
} from "./filtered-stats.js";

export function runFilteredStatsFixtures(): void {
  testEmptyItemsYieldsZeroCount();
  testAggregatesFilteredCountByReason();
  testNonFilteredItemsAreExcluded();
  testMissingReasonBucketedAsUnspecified();
  testReasonCaseSensitive();
  testRenderSectionProducesZhCnSummary();
  testRenderSectionOmitsSectionWhenZeroFiltered();
}

// ─── Tests ───────────────────────────────────────────────

function testEmptyItemsYieldsZeroCount(): void {
  const summary = summarizeFilteredStats([]);
  assert(
    summary.count === 0 && Object.keys(summary.byReason).length === 0,
    `空 items 必须得到 count=0，得到 ${JSON.stringify(summary)}`,
  );
}

function testAggregatesFilteredCountByReason(): void {
  const items: FilteredItemInput[] = [
    { status: "FILTERED", filteredReason: "LOW_RELEVANCE" },
    { status: "FILTERED", filteredReason: "LOW_RELEVANCE" },
    { status: "FILTERED", filteredReason: "DUPLICATE_NOISE" },
  ];
  const summary = summarizeFilteredStats(items);
  assert(summary.count === 3, `count 应为 3，得到 ${summary.count}`);
  assert(
    summary.byReason["LOW_RELEVANCE"] === 2 && summary.byReason["DUPLICATE_NOISE"] === 1,
    `byReason 分组错误，得到 ${JSON.stringify(summary.byReason)}`,
  );
}

function testNonFilteredItemsAreExcluded(): void {
  const items: FilteredItemInput[] = [
    { status: "FILTERED", filteredReason: "LOW_RELEVANCE" },
    { status: "ANALYZED", filteredReason: "LOW_RELEVANCE" },
    { status: "DUPLICATE" },
    { status: "ERROR" },
  ];
  const summary = summarizeFilteredStats(items);
  assert(
    summary.count === 1,
    `只有 FILTERED 计入 count，得到 ${summary.count}`,
  );
  assert(
    summary.byReason["LOW_RELEVANCE"] === 1,
    `非 FILTERED 不应进入 byReason，得到 ${JSON.stringify(summary.byReason)}`,
  );
}

function testMissingReasonBucketedAsUnspecified(): void {
  const items: FilteredItemInput[] = [
    { status: "FILTERED" }, // 无 reason
    { status: "FILTERED", filteredReason: "" }, // 空 reason
    { status: "FILTERED", filteredReason: "LOW_RELEVANCE" },
  ];
  const summary = summarizeFilteredStats(items);
  assert(summary.count === 3, `count 应为 3，得到 ${summary.count}`);
  assert(
    (summary.byReason["unspecified"] ?? 0) === 2,
    `缺失/空 reason 应归入 unspecified=2，得到 ${JSON.stringify(summary.byReason)}`,
  );
  assert(
    summary.byReason["LOW_RELEVANCE"] === 1,
    `有 reason 应单独分组，得到 ${JSON.stringify(summary.byReason)}`,
  );
}

function testReasonCaseSensitive(): void {
  const items: FilteredItemInput[] = [
    { status: "FILTERED", filteredReason: "LOW_RELEVANCE" },
    { status: "FILTERED", filteredReason: "low_relevance" },
  ];
  const summary = summarizeFilteredStats(items);
  assert(
    summary.byReason["LOW_RELEVANCE"] === 1 && summary.byReason["low_relevance"] === 1,
    `reason 应大小写敏感分桶，得到 ${JSON.stringify(summary.byReason)}`,
  );
}

function testRenderSectionProducesZhCnSummary(): void {
  const summary: FilteredStatsSummary = {
    count: 20,
    byReason: { LOW_RELEVANCE: 12, DUPLICATE_NOISE: 8 },
  };
  const section = renderFilteredStatsSection(summary);
  assert(
    section.includes("低价值信息已过滤 20 条"),
    `摘要行必须含中文「低价值信息已过滤 N 条」，得到:\n${section}`,
  );
  assert(
    section.includes("LOW_RELEVANCE") && section.includes("12"),
    `应列出 reason 明细，得到:\n${section}`,
  );
  assert(
    section.includes("DUPLICATE_NOISE") && section.includes("8"),
    `应列出第二个 reason 明细，得到:\n${section}`,
  );
}

function testRenderSectionOmitsSectionWhenZeroFiltered(): void {
  const summary: FilteredStatsSummary = { count: 0, byReason: {} };
  const section = renderFilteredStatsSection(summary);
  assert(
    section === "" || section.trim() === "",
    `count=0 时应返回空字符串以省略分区，得到 "${section}"`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}