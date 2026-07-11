import {
  buildRuleFallbackSummary,
  buildTopicProfileContext,
  createUtcDayRange,
  createIntelligenceEventDraft,
  evaluateRelevance,
  generatePreferenceDeltas,
} from "./index.js";
import { checkInstantPushQuota, resolveEffectivePlan } from "./quota.js";

export function runCoreFixtures(): void {
  testUtcDayRangeUsesStableBoundaries();
  testRuleFallbackSummaryCleansRssMetadata();
  testRuleFallbackSummaryUsesTitleWhenSummaryIsPureMetadata();
  testRuleFallbackSummaryUsesCleanSummaryWhenPresent();
  testRuleFallbackSummaryFallsBackToTitle();
  testCreateIntelligenceEventDraftUsesCleanSummary();
  testCreateIntelligenceEventDraftReturnsNullForIrrelevant();
  testExcludedScopeOverridesPositiveSignals();
  testEntityAndIncludeScopeDriveExplainableFallback();
  testPreferenceDeltasKeepTopicsIsolated();
  testCategoryFeedbackOnlyChangesCategoryWeight();
  testTopicProfileContextUsesTopicIdentityAndSanitizesLists();
  testInstantPushPlanAccess();
}

function testInstantPushPlanAccess(): void {
  const now = new Date("2026-07-11T00:00:00.000Z");
  assert(!checkInstantPushQuota("FREE", false).allowed, "Free must not use instant push.");
  assert(checkInstantPushQuota("PLUS", false).allowed, "Plus must use instant push.");
  assert(checkInstantPushQuota("PRO", false).allowed, "Pro must use instant push.");
  assert(checkInstantPushQuota("FREE", true).allowed, "Self-hosted must bypass the plan gate.");
  assert(resolveEffectivePlan({ plan: "PRO", status: "EXPIRED", isSelfHosted: false, now }) === "FREE", "Expired plans must resolve to Free.");
  assert(resolveEffectivePlan({ plan: "PLUS", status: "CANCELED", isSelfHosted: false, currentPeriodEnd: "2026-07-12T00:00:00.000Z", now }) === "PLUS", "Canceled plans remain active through their period.");
  assert(resolveEffectivePlan({ plan: "PLUS", status: "CANCELED", isSelfHosted: false, currentPeriodEnd: "2026-07-10T00:00:00.000Z", now }) === "FREE", "Ended canceled plans must resolve to Free.");
}

function testExcludedScopeOverridesPositiveSignals(): void {
  const item = {
    fetchedAt: new Date("2026-01-01"),
    id: "excluded-item",
    summary: "AI 平台招聘广告",
    title: "OpenAI AI 平台招聘广告",
    topicProfile: {
      excludeScope: ["招聘广告"],
      keywords: ["AI"],
    },
    url: "https://example.com/excluded",
  };
  const decision = evaluateRelevance(item);

  assert(decision.isRelevant === false, "Exclude scope must override keyword matches.");
  assert(decision.score === 0, "Excluded content must receive a zero relevance score.");
  assert(
    decision.matchedExcludeScopes.join(",") === "招聘广告",
    "The exclusion reason must stay explainable.",
  );
  assert(
    createIntelligenceEventDraft(item, decision) === null,
    "Excluded content must not create an event draft.",
  );
}

function testEntityAndIncludeScopeDriveExplainableFallback(): void {
  const entityItem = {
    fetchedAt: new Date("2026-01-01"),
    id: "entity-item",
    summary: "OpenAI 发布新产品。",
    title: "产品发布",
    topicProfile: {
      entities: ["OpenAI"],
      includeScope: ["供应链进展"],
      keywords: ["not-present"],
    },
    url: "https://example.com/entity",
  };
  const entityDecision = evaluateRelevance(entityItem);
  const entityDraft = createIntelligenceEventDraft(entityItem, entityDecision);

  assert(entityDecision.isRelevant, "An entity match must pass deterministic relevance.");
  assert(entityDecision.matchedEntities[0] === "OpenAI", "Entity match must be retained.");
  assert(entityDraft?.category === "entity:OpenAI", "Entity-only fallback must explain its category.");
  assert(entityDraft?.entities[0] === "OpenAI", "Fallback event must persist matched entities.");

  const scopeDecision = evaluateRelevance({
    ...entityItem,
    id: "scope-item",
    summary: "本周供应链进展汇总。",
    topicProfile: {
      entities: ["not-present"],
      includeScope: ["供应链进展"],
      keywords: ["also-not-present"],
    },
    url: "https://example.com/scope",
  });

  assert(scopeDecision.isRelevant, "An include-scope match must pass deterministic relevance.");
  assert(
    scopeDecision.matchedIncludeScopes[0] === "供应链进展",
    "Include-scope match must stay explainable.",
  );
}

function testTopicProfileContextUsesTopicIdentityAndSanitizesLists(): void {
  const context = buildTopicProfileContext(
    {
      entities: [" OpenAI ", "OpenAI", 42],
      excludeScope: ["广告", ""],
      importanceRules: ["官方优先"],
      includeScope: ["模型发布"],
      keywords: [" AI ", "AI", "Agent"],
      name: "stale profile name",
    },
    {
      description: " 关注模型基础设施 ",
      name: " AI 基础设施 ",
    },
  );

  assert(context.name === "AI 基础设施", "Topic name must come from the Topic row.");
  assert(
    context.description === "关注模型基础设施",
    "Topic description must come from the Topic row.",
  );
  assert(context.keywords.join(",") === "AI,Agent", "Profile lists must be trimmed and deduplicated.");
  assert(context.entities.join(",") === "OpenAI", "Non-string entities must be removed.");
}

function testPreferenceDeltasKeepTopicsIsolated(): void {
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      kind: "SAVE",
      sourceId: null,
      topicId: "topic-1",
    },
    {
      category: "AI",
      kind: "DISMISS",
      sourceId: null,
      topicId: "topic-2",
    },
  ]);

  assert(deltas.length === 2, "The same category in two topics must create two deltas.");
  const first = deltas.find((delta) => delta.topicId === "topic-1");
  const second = deltas.find((delta) => delta.topicId === "topic-2");
  assert(first?.value.weight === 2, "Topic 1 must retain its positive signal.");
  assert(second?.value.weight === -2, "Topic 2 must retain its negative signal.");
}

function testCategoryFeedbackOnlyChangesCategoryWeight(): void {
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      kind: "CATEGORY_UP",
      sourceId: "source-1",
      topicId: "topic-1",
    },
    {
      category: "AI",
      kind: "CATEGORY_DOWN",
      sourceId: "source-2",
      topicId: "topic-2",
    },
  ]);

  assert(deltas.length === 2, "Category feedback must produce one category delta per topic.");
  assert(
    deltas.every((delta) => delta.key === "category:AI"),
    "Explicit category feedback must not also change source preference.",
  );
}

function testUtcDayRangeUsesStableBoundaries(): void {
  const result = createUtcDayRange(new Date("2026-07-11T23:59:59.999+08:00"));

  assert(
    result.rangeStart.toISOString() === "2026-07-11T00:00:00.000Z",
    `Unexpected UTC day start: ${result.rangeStart.toISOString()}`,
  );
  assert(
    result.rangeEnd.toISOString() === "2026-07-12T00:00:00.000Z",
    `Unexpected UTC day end: ${result.rangeEnd.toISOString()}`,
  );
}

function testRuleFallbackSummaryCleansRssMetadata(): void {
  const summary =
    'Article URL: <a href="https://example.com/article">link</a> Points: 129 # Comments: 24 Comments URL: https://news.ycombinator.com/item?id=123';
  const result = buildRuleFallbackSummary(summary, "Some Title");

  assert(
    !result.includes("Article URL:"),
    "Rule fallback should strip Article URL label",
  );
  assert(
    !result.includes("Points:"),
    "Rule fallback should strip Points label",
  );
  assert(
    !result.includes("Comments URL:"),
    "Rule fallback should strip Comments URL label",
  );
  assert(
    !result.includes("https://"),
    "Rule fallback should strip bare URLs",
  );
}

function testRuleFallbackSummaryUsesTitleWhenSummaryIsPureMetadata(): void {
  const summary =
    'Article URL: https://example.com/article Points: 129 # Comments: 24 Comments URL: https://news.ycombinator.com/item?id=123';
  const result = buildRuleFallbackSummary(summary, "Mistral Releases Robostral");

  assert(
    result === "Mistral Releases Robostral",
    `Rule fallback should use title when summary is pure RSS metadata, got: "${result}"`,
  );
}

function testRuleFallbackSummaryUsesCleanSummaryWhenPresent(): void {
  const summary = "This is a normal article summary about AI infrastructure.";
  const result = buildRuleFallbackSummary(summary, "Some Title");

  assert(
    result === "This is a normal article summary about AI infrastructure.",
    "Rule fallback should use clean summary when no RSS metadata detected",
  );
}

function testRuleFallbackSummaryFallsBackToTitle(): void {
  const result = buildRuleFallbackSummary(null, "Fallback Title");

  assert(
    result === "Fallback Title",
    "Rule fallback should use title when summary is null",
  );

  const emptyResult = buildRuleFallbackSummary("", "");
  assert(
    emptyResult === "待 AI 生成摘要。",
    `Rule fallback should use placeholder when both summary and title are empty, got: "${emptyResult}"`,
  );
}

function testCreateIntelligenceEventDraftUsesCleanSummary(): void {
  const item = {
    fetchedAt: new Date("2026-01-01"),
    id: "test-item-1",
    publishedAt: new Date("2026-01-01"),
    summary:
      "Article URL: https://example.com/article Points: 100 # Comments: 10",
    title: "Test Event Title",
    topicProfile: { keywords: ["test"] },
    url: "https://example.com",
  };
  const decision = evaluateRelevance(item);
  const draft = createIntelligenceEventDraft(item, decision);

  assert(draft !== null, "Draft should be created for relevant item");
  assert(
    draft!.summary === "Test Event Title",
    `Draft summary should be cleaned (use title for pure RSS metadata), got: "${draft!.summary}"`,
  );
}

function testCreateIntelligenceEventDraftReturnsNullForIrrelevant(): void {
  const item = {
    fetchedAt: new Date("2026-01-01"),
    id: "test-item-2",
    publishedAt: new Date("2026-01-01"),
    summary: "Unrelated content",
    title: "Unrelated Title",
    topicProfile: { keywords: ["nonexistent"] },
    url: "https://example.com",
  };
  const decision = evaluateRelevance(item);
  const draft = createIntelligenceEventDraft(item, decision);

  assert(draft === null, "Draft should be null for irrelevant item");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
