import {
  renderDailyBriefingMarkdown,
  renderPeriodBriefingMarkdown,
  type DailyBriefingInput,
  type PeriodBriefingInput,
} from "./render-briefing.js";
import type { DigestStyle } from "./topic-profile.js";
import type { MarkdownEventInput } from "./render-event.js";

export function runRenderBriefingFixtures(): void {
  testDailyBriefingDefaultsToZhCnNoEnglishRemnants();
  testDailyBriefingShowsStructuredSectionsPerSpec();
  testDailyBriefingCompactStructureDiffersFromStandard();
  testDailyBriefingDetailedStructureShowsExtraSections();
  testDailyBriefingDetailLevelBriefTruncatesSummary();
  testDailyBriefingDetailLevelComprehensiveShowsFullSummary();
  testDailyBriefingMaxEventsCapsOutput();
  testDailyBriefingRendersEntitiesFollowUpSuggestionSecondarySources();
  testPeriodBriefingDefaultsToZhCnNoEnglishRemnants();
  testPeriodBriefingShowsStructuredSectionsPerSpec();
  testPeriodBriefingMaxEventsFloorRespected();
  testPeriodBriefingCompactStructureDiffersFromStandard();
  testEmptyEventsDailyProducesZhCnMessage();
  testEmptyEventsPeriodProducesZhCnMessage();
  testPreferencesInfluenceContent();
}

// ─── Helpers ──────────────────────────────────────────────

function makeEvent(overrides: Partial<MarkdownEventInput> = {}): MarkdownEventInput {
  return {
    title: "C919 新增商业航线运营数据披露",
    summary: "中国商飞公布 C919 最新商业航线运营数据，表明国产大飞机进入更稳定商业化阶段。",
    score: 85,
    category: "航空",
    sourceName: "中国商飞官网",
    sourceUrl: "https://comac.cc",
    url: "https://comac.cc/news/c919-data",
    explanation: "说明国产大飞机从示范运营进入更稳定商业化阶段。",
    entities: ["中国商飞", "C919", "东航"],
    followUpSuggestion: "继续跟踪月度航班频次和机队可用率。",
    secondarySources: [
      { sourceName: "民航资源网", url: "https://news.carnoc.com/c919" },
      { sourceName: "航空时报", url: null },
    ],
    occurredAt: new Date("2026-07-20T08:00:00Z"),
    ...overrides,
  };
}

function makeDailyInput(overrides: Partial<DailyBriefingInput> = {}): DailyBriefingInput {
  return {
    digestStyle: { structure: "standard", detailLevel: "standard", maxEvents: 10 },
    events: [makeEvent()],
    generatedAt: new Date("2026-07-20T10:00:00Z"),
    topicName: "中国商业航空进展",
    ...overrides,
  };
}

function makePeriodInput(overrides: Partial<PeriodBriefingInput> = {}): PeriodBriefingInput {
  return {
    digestStyle: { structure: "standard", detailLevel: "standard", maxEvents: 10 },
    events: [makeEvent()],
    generatedAt: new Date("2026-07-20T10:00:00Z"),
    period: "WEEKLY",
    rangeStart: new Date("2026-07-14T00:00:00Z"),
    rangeEnd: new Date("2026-07-21T00:00:00Z"),
    topicName: "中国商业航空进展",
    ...overrides,
  };
}

// ─── Test: 默认 zh-CN，无英文模板残留 ────────────────────

function testDailyBriefingDefaultsToZhCnNoEnglishRemnants(): void {
  const md = renderDailyBriefingMarkdown(makeDailyInput());
  // 英文模板残留检查 - 不应出现这些英文字符串
  const englishRemnants = [
    "Daily Briefing",
    "Executive Summary",
    "Top Events",
    "Learned Preferences",
    "Follow Up",
    "Today's briefing contains",
    "No ranked intelligence",
    "No preference memory",
    "Mark reviewed events",
    "Export important",
    "Why it matters",
    "Also reported by",
    "Unknown source",
    "Score:",
    "Category:",
    "Original:",
  ];
  for (const remnant of englishRemnants) {
    assert(
      !md.includes(remnant),
      `每日简报不应残留英文模板 "${remnant}"，但输出中包含它。`,
    );
  }
}

// ─── Test: 分区展示事件、重要性、影响对象、可信度、后续动作、多来源 ──

function testDailyBriefingShowsStructuredSectionsPerSpec(): void {
  const md = renderDailyBriefingMarkdown(makeDailyInput());
  // SPEC §4.2 分区标题
  assert(md.includes("每日情报") || md.includes("每日简报"), `简报应含中文标题，得到:\n${md.slice(0, 500)}`);
  // 事件分区
  assert(md.includes("今日最重要进展") || md.includes("重点事件"), `简报应含事件分区标题。`);
  // 重要性（为什么重要）
  assert(md.includes("为什么重要") || md.includes("重要性"), `简报应含重要性分区。`);
  // 影响对象（entities）
  assert(md.includes("影响对象") || md.includes("相关实体"), `简报应含影响对象分区。`);
  // 可信度（来源可信度）
  assert(md.includes("可信度") || md.includes("来源可信"), `简报应含可信度分区。`);
  // 后续动作
  assert(md.includes("后续动作") || md.includes("建议动作") || md.includes("后续建议"), `简报应含后续动作分区。`);
  // 多来源
  assert(md.includes("多来源") || md.includes("其他来源") || md.includes("也报道了"), `简报应含多来源分区。`);
}

// ─── Test: compact 结构与 standard 不同 ──────────────────

function testDailyBriefingCompactStructureDiffersFromStandard(): void {
  const standardInput = makeDailyInput();
  const compactInput = makeDailyInput({
    digestStyle: { structure: "compact", detailLevel: "standard", maxEvents: 10 },
  });
  const standardMd = renderDailyBriefingMarkdown(standardInput);
  const compactMd = renderDailyBriefingMarkdown(compactInput);
  assert(
    standardMd !== compactMd,
    "compact 结构输出应与 standard 不同。",
  );
  // compact 不应含详细分区
  assert(
    !compactMd.includes("为什么重要") && !compactMd.includes("影响对象"),
    "compact 结构不应包含详细分区（重要性/影响对象）。",
  );
  // standard 应含详细分区
  assert(
    standardMd.includes("为什么重要") || standardMd.includes("影响对象"),
    "standard 结构应包含详细分区。",
  );
}

// ─── Test: detailed 结构比 standard 多内容 ────────────────

function testDailyBriefingDetailedStructureShowsExtraSections(): void {
  const standardInput = makeDailyInput();
  const detailedInput = makeDailyInput({
    digestStyle: { structure: "detailed", detailLevel: "comprehensive", maxEvents: 10 },
  });
  const standardMd = renderDailyBriefingMarkdown(standardInput);
  const detailedMd = renderDailyBriefingMarkdown(detailedInput);
  // detailed 应比 standard 更长或包含额外分区
  assert(
    detailedMd.length >= standardMd.length,
    "detailed 结构输出应至少与 standard 一样长。",
  );
  // detailed 可以包含额外信息（如低价值过滤统计占位、评分明细等）
  // 关键是 detailed 和 standard 有可观察差异
  assert(
    detailedMd !== standardMd,
    "detailed 结构输出应与 standard 不同。",
  );
}

// ─── Test: detailLevel=brief 截断摘要 ─────────────────────

function testDailyBriefingDetailLevelBriefTruncatesSummary(): void {
  const longSummary = "这是一段很长的摘要内容。".repeat(20);
  const briefInput = makeDailyInput({
    events: [makeEvent({ summary: longSummary })],
    digestStyle: { structure: "standard", detailLevel: "brief", maxEvents: 10 },
  });
  const comprehensiveInput = makeDailyInput({
    events: [makeEvent({ summary: longSummary })],
    digestStyle: { structure: "standard", detailLevel: "comprehensive", maxEvents: 10 },
  });
  const briefMd = renderDailyBriefingMarkdown(briefInput);
  const comprehensiveMd = renderDailyBriefingMarkdown(comprehensiveInput);
  // brief 应比 comprehensive 短
  assert(
    briefMd.length < comprehensiveMd.length,
    `detailLevel=brief 应比 comprehensive 产生更短的输出 (brief=${briefMd.length}, comp=${comprehensiveMd.length})。`,
  );
}

// ─── Test: detailLevel=comprehensive 展示完整摘要 ────────

function testDailyBriefingDetailLevelComprehensiveShowsFullSummary(): void {
  const longSummary = "这是一段很长的摘要内容，包含很多细节。".repeat(15);
  const input = makeDailyInput({
    events: [makeEvent({ summary: longSummary })],
    digestStyle: { structure: "standard", detailLevel: "comprehensive", maxEvents: 10 },
  });
  const md = renderDailyBriefingMarkdown(input);
  // comprehensive 不应截断（或截断阈值很高）
  assert(
    md.includes(longSummary.slice(0, 50)),
    "detailLevel=comprehensive 应包含摘要内容的前 50 字符。",
  );
}

// ─── Test: maxEvents 限制输出事件数 ───────────────────────

function testDailyBriefingMaxEventsCapsOutput(): void {
  const events = Array.from({ length: 5 }, (_, i) =>
    makeEvent({ title: `事件 ${i + 1}`, url: `https://example.com/${i + 1}` }),
  );
  const input = makeDailyInput({
    events,
    digestStyle: { structure: "standard", detailLevel: "standard", maxEvents: 3 },
  });
  const md = renderDailyBriefingMarkdown(input);
  // 应包含前 3 个事件
  assert(md.includes("事件 1"), "maxEvents=3 应包含事件 1。");
  assert(md.includes("事件 2"), "maxEvents=3 应包含事件 2。");
  assert(md.includes("事件 3"), "maxEvents=3 应包含事件 3。");
  // 不应包含第 4、5 个
  assert(!md.includes("事件 4"), "maxEvents=3 不应包含事件 4。");
  assert(!md.includes("事件 5"), "maxEvents=3 不应包含事件 5。");
}

// ─── Test: entities/followUpSuggestion/secondarySources 出现在输出 ──

function testDailyBriefingRendersEntitiesFollowUpSuggestionSecondarySources(): void {
  const md = renderDailyBriefingMarkdown(makeDailyInput());
  // entities 应出现在影响对象或实体分区
  assert(md.includes("中国商飞"), "简报应包含 entity「中国商飞」。");
  assert(md.includes("C919"), "简报应包含 entity「C919」。");
  assert(md.includes("东航"), "简报应包含 entity「东航」。");
  // followUpSuggestion 应出现在后续动作分区
  assert(
    md.includes("继续跟踪月度航班频次和机队可用率"),
    "简报应包含 followUpSuggestion 内容。",
  );
  // secondarySources 应出现在多来源分区
  assert(md.includes("民航资源网"), "简报应包含 secondarySource「民航资源网」。");
  assert(md.includes("航空时报"), "简报应包含 secondarySource「航空时报」。");
}

// ─── Test: 周报/月报默认 zh-CN 无英文残留 ─────────────────

function testPeriodBriefingDefaultsToZhCnNoEnglishRemnants(): void {
  const md = renderPeriodBriefingMarkdown(makePeriodInput());
  const englishRemnants = [
    "Weekly Briefing",
    "Monthly Briefing",
    "Key Events",
    "Learned Preferences",
    "Follow Up",
    "Review key events",
    "Export important",
    "Why it matters",
    "Also reported by",
    "Score:",
    "Category:",
    "Original:",
    "No ranked",
  ];
  for (const remnant of englishRemnants) {
    assert(
      !md.includes(remnant),
      `周期简报不应残留英文模板 "${remnant}"。`,
    );
  }
}

// ─── Test: 周报/月报分区展示 ─────────────────────────────

function testPeriodBriefingShowsStructuredSectionsPerSpec(): void {
  const md = renderPeriodBriefingMarkdown(makePeriodInput());
  assert(md.includes("周报") || md.includes("月报"), "周期简报应含中文周期标签。");
  assert(md.includes("重点事件") || md.includes("今日最重要进展"), "周期简报应含事件分区。");
  assert(md.includes("为什么重要") || md.includes("重要性"), "周期简报应含重要性分区。");
  assert(md.includes("影响对象") || md.includes("相关实体"), "周期简报应含影响对象分区。");
  assert(md.includes("可信度") || md.includes("来源可信"), "周期简报应含可信度分区。");
  assert(
    md.includes("后续动作") || md.includes("建议动作") || md.includes("后续建议"),
    "周期简报应含后续动作分区。",
  );
  assert(
    md.includes("多来源") || md.includes("其他来源") || md.includes("也报道了"),
    "周期简报应含多来源分区。",
  );
}

// ─── Test: 周报/月报 maxEvents 下限 15 ────────────────────

function testPeriodBriefingMaxEventsFloorRespected(): void {
  const events = Array.from({ length: 20 }, (_, i) =>
    makeEvent({ title: `周期事件 ${i + 1}`, url: `https://example.com/p${i + 1}` }),
  );
  const input = makePeriodInput({
    events,
    digestStyle: { structure: "standard", detailLevel: "standard", maxEvents: 5 },
  });
  const md = renderPeriodBriefingMarkdown(input);
  // maxEvents=5 但周期简报 floor 是 15，所以应包含前 15 个
  assert(md.includes("周期事件 1"), "周期简报 maxEvents floor 应包含事件 1。");
  assert(md.includes("周期事件 15"), "周期简报 maxEvents floor=15 应包含事件 15。");
  assert(!md.includes("周期事件 16"), "周期简报 floor=15 不应包含事件 16。");
}

// ─── Test: 周报/月报 compact 与 standard 不同 ────────────

function testPeriodBriefingCompactStructureDiffersFromStandard(): void {
  const standardMd = renderPeriodBriefingMarkdown(makePeriodInput());
  const compactMd = renderPeriodBriefingMarkdown(
    makePeriodInput({
      digestStyle: { structure: "compact", detailLevel: "standard", maxEvents: 10 },
    }),
  );
  assert(standardMd !== compactMd, "周期简报 compact 应与 standard 不同。");
  assert(
    !compactMd.includes("为什么重要") && !compactMd.includes("影响对象"),
    "周期简报 compact 不应含详细分区。",
  );
  assert(
    standardMd.includes("为什么重要") || standardMd.includes("影响对象"),
    "周期简报 standard 应含详细分区。",
  );
}

// ─── Test: 空事件日报告中文消息 ──────────────────────────

function testEmptyEventsDailyProducesZhCnMessage(): void {
  const md = renderDailyBriefingMarkdown(makeDailyInput({ events: [] }));
  assert(
    md.includes("无") || md.includes("没有") || md.includes("暂无"),
    "空事件日报告应含中文「无/没有/暂无」消息。",
  );
  assert(
    !md.includes("No ranked intelligence"),
    "空事件日报告不应含英文残留。",
  );
}

// ─── Test: 空事件周期报告中文消息 ───────────────────────

function testEmptyEventsPeriodProducesZhCnMessage(): void {
  const md = renderPeriodBriefingMarkdown(makePeriodInput({ events: [] }));
  assert(
    md.includes("无") || md.includes("没有") || md.includes("暂无"),
    "空事件周期报告应含中文消息。",
  );
  assert(
    !md.includes("No ranked") && !md.includes("No events"),
    "空事件周期报告不应含英文残留。",
  );
}

// ─── Test: preferences 真正影响选择 ──────────────────────

function testPreferencesInfluenceContent(): void {
  const preferences = [
    { explanation: "用户多次标记不感兴趣", key: "航旅营销", weight: -0.5 },
    { explanation: "用户关注 C929", key: "C929", weight: 0.8 },
  ];
  const inputWithPrefs = makeDailyInput({ preferences });
  const inputWithoutPrefs = makeDailyInput({ preferences: undefined });
  const mdWith = renderDailyBriefingMarkdown(inputWithPrefs);
  const mdWithout = renderDailyBriefingMarkdown(inputWithoutPrefs);
  // 有 preferences 时输出应不同于无 preferences
  assert(
    mdWith !== mdWithout,
    "有 preferences 时简报输出应与无 preferences 不同。",
  );
  // preferences 内容应出现在输出中（standard/detailed 结构）
  assert(mdWith.includes("C929"), "简报应包含 preference key「C929」。");
  assert(
    mdWith.includes("航旅营销") || mdWith.includes("偏好") || mdWith.includes("学习到的偏好"),
    "简报应含偏好分区或偏好内容。",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
