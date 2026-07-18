import {
  buildRuleFallbackSummary,
  buildTopicProfileContext,
  calculateGravityScore,
  createUtcDayRange,
  createIntelligenceEventDraft,
  createIntelligenceEventDraftFromExtraction,
  evaluateRelevance,
  generatePreferenceDeltas,
  resolveScoringBreakdown,
} from "./index.js";
import type { AiEventExtraction } from "./index.js";
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
  testPreferenceDeltasAccumulateSameTopicDismiss();
  testPreferenceDeltasKeepCrossTopicDismissIsolated();
  testPreferenceDeltasAreIdempotentOnSameFeedbackEvent();
  testPreferenceDeltasApplyTimeDecayToOldSignals();
  testPreferenceDeltasIncludeEnhancedFeedbackWithoutCrossTopicMerge();
  testPreferenceDeltasSurviveMissingFeedbackEventIdAcrossTopics();
  testMoreLikeThisDoesNotDuplicateCategoryKey();
  testTopicProfileContextUsesTopicIdentityAndSanitizesLists();
  testInstantPushPlanAccess();
  testGravityScoreSeparatesRelevanceAndImportance();
  testGravityScoreSeparatesSourceQualityFactor();
  testGravityScoreAppliesPreferenceAdjustment();
  testRuleDraftEmitsScoringBreakdown();
  testExtractionDraftEmitsScoringBreakdown();
  testLegacyEventResolvesBackwardCompatibleBreakdown();
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

function testPreferenceDeltasAccumulateSameTopicDismiss(): void {
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      feedbackEventId: "fb-dismiss-1",
      kind: "DISMISS",
      topicId: "topic-1",
    },
    {
      category: "AI",
      feedbackEventId: "fb-dismiss-2",
      kind: "DISMISS",
      topicId: "topic-1",
    },
    {
      category: "AI",
      feedbackEventId: "fb-dismiss-3",
      kind: "DISMISS",
      topicId: "topic-1",
    },
  ]);

  assert(deltas.length === 1, "Three same-topic DISMISS must collapse into one delta.");
  const delta = deltas[0];
  assert(delta !== undefined, "Delta must exist.");
  assert(delta.value.signalCount === 3, "signalCount must accumulate to 3.");
  assert(
    delta.value.weight === -4,
    `Three DISMISS (-2 each = -6) must clamp to -4, got ${delta.value.weight}.`,
  );
  assert(
    delta.explanation.includes("3 feedback signals"),
    "Explanation must reflect 3 accumulated signals.",
  );
}

function testPreferenceDeltasKeepCrossTopicDismissIsolated(): void {
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      feedbackEventId: "fb-cross-1",
      kind: "DISMISS",
      topicId: "topic-1",
    },
    {
      category: "AI",
      feedbackEventId: "fb-cross-2",
      kind: "DISMISS",
      topicId: "topic-2",
    },
  ]);

  assert(deltas.length === 2, "Cross-topic DISMISS must produce two deltas, not merge.");
  const first = deltas.find((d) => d.topicId === "topic-1");
  const second = deltas.find((d) => d.topicId === "topic-2");
  assert(first?.value.weight === -2, "Topic 1 DISMISS weight must be -2.");
  assert(second?.value.weight === -2, "Topic 2 DISMISS weight must be -2.");
  assert(
    first?.value.signalCount === 1 && second?.value.signalCount === 1,
    "Each topic must count its own signal independently.",
  );
}

function testPreferenceDeltasAreIdempotentOnSameFeedbackEvent(): void {
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      feedbackEventId: "fb-replay-1",
      kind: "DISMISS",
      topicId: "topic-1",
    },
    {
      category: "AI",
      feedbackEventId: "fb-replay-1",
      kind: "DISMISS",
      topicId: "topic-1",
    },
  ]);

  assert(deltas.length === 1, "Same feedbackEventId replay must be idempotent.");
  assert(
    deltas[0]?.value.signalCount === 1,
    "signalCount must not inflate on replay.",
  );
}

function testPreferenceDeltasApplyTimeDecayToOldSignals(): void {
  const now = new Date("2026-07-18T00:00:00.000Z");
  const oldDate = new Date("2026-06-17T00:00:00.000Z"); // 31 days ago
  const deltas = generatePreferenceDeltas(
    [
      {
        category: "AI",
        createdAt: oldDate,
        feedbackEventId: "fb-old",
        kind: "SAVE",
        topicId: "topic-old",
        value: 4,
      },
      {
        category: "AI",
        createdAt: now,
        feedbackEventId: "fb-new",
        kind: "SAVE",
        topicId: "topic-new",
        value: 4,
      },
    ],
    now,
  );

  const oldDelta = deltas.find((d) => d.topicId === "topic-old");
  const newDelta = deltas.find((d) => d.topicId === "topic-new");
  assert(oldDelta !== undefined, "Old signal must still produce a delta.");
  assert(newDelta !== undefined, "New signal must produce a delta.");
  assert(
    oldDelta!.value.signalCount === 1,
    "Old signal count must be 1.",
  );
  assert(
    Math.abs(oldDelta!.value.weight) < Math.abs(newDelta!.value.weight),
    `Old signal weight (${oldDelta!.value.weight}) must be decayed below new (${newDelta!.value.weight}).`,
  );
}

function testPreferenceDeltasIncludeEnhancedFeedbackWithoutCrossTopicMerge(): void {
  const deltas = generatePreferenceDeltas([
    {
      feedbackEventId: "fb-sq-up-1",
      kind: "SOURCE_QUALITY_UP",
      sourceId: "source-1",
      sourceName: "Source One",
      topicId: "topic-1",
    },
    {
      feedbackEventId: "fb-sq-up-2",
      kind: "SOURCE_QUALITY_UP",
      sourceId: "source-2",
      sourceName: "Source Two",
      topicId: "topic-2",
    },
    {
      category: "AI",
      feedbackEventId: "fb-score-up",
      kind: "SCORE_UP",
      topicId: "topic-3",
    },
  ]);

  assert(
    deltas.length === 3,
    "Enhanced feedback on different topics must not merge into one delta.",
  );
  const topic1Delta = deltas.find((d) => d.topicId === "topic-1");
  const topic2Delta = deltas.find((d) => d.topicId === "topic-2");
  const scoreDelta = deltas.find((d) => d.topicId === "topic-3");
  assert(
    topic1Delta?.key === "source:source-1",
    "SOURCE_QUALITY_UP must target the source key.",
  );
  assert(
    topic2Delta?.key === "source:source-2",
    "Second topic's SOURCE_QUALITY_UP must not be swallowed.",
  );
  assert(
    scoreDelta?.key === "category:AI",
    "SCORE_UP must target the category key.",
  );
}

function testPreferenceDeltasSurviveMissingFeedbackEventIdAcrossTopics(): void {
  // Upstream contract violation: feedbackEventId missing. Core must not crash,
  // and must not swallow cross-topic signals that share the same kind just
  // because their dedup key would otherwise collapse to "::KIND".
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      kind: "DISMISS",
      topicId: "topic-a",
    },
    {
      category: "AI",
      kind: "DISMISS",
      topicId: "topic-b",
    },
  ]);

  assert(
    deltas.length === 2,
    "Missing feedbackEventId must not cause cross-topic DISMISS to be swallowed.",
  );
  const a = deltas.find((d) => d.topicId === "topic-a");
  const b = deltas.find((d) => d.topicId === "topic-b");
  assert(a?.value.signalCount === 1, "Topic A must count its own signal.");
  assert(b?.value.signalCount === 1, "Topic B must count its own signal.");
  assert(
    a?.value.weight === -2 && b?.value.weight === -2,
    "Each topic must retain its independent DISMISS weight.",
  );
}

function testMoreLikeThisDoesNotDuplicateCategoryKey(): void {
  // Regression: MORE_LIKE_THIS with a category must produce exactly one
  // delta for that category (not two), because preferenceKeysForEvent
  // already emits category:<cat>. Double-counting inflated both signalCount
  // and weight for a single feedback signal.
  const deltas = generatePreferenceDeltas([
    {
      category: "AI",
      feedbackEventId: "fb-mlt-1",
      kind: "MORE_LIKE_THIS",
      sourceId: "source-1",
      sourceName: "Source One",
      topicId: "topic-1",
    },
  ]);

  const categoryDelta = deltas.find((d) => d.key === "category:AI");
  assert(
    categoryDelta !== undefined,
    "MORE_LIKE_THIS must produce a category delta.",
  );
  assert(
    categoryDelta!.value.signalCount === 1,
    `MORE_LIKE_THIS single signal must count once, got ${categoryDelta!.value.signalCount}.`,
  );
  // MORE_LIKE_THIS base weight is 2 (see feedbackSignalWeight).
  assert(
    categoryDelta!.value.weight === 2,
    `MORE_LIKE_THIS single signal weight must be exactly 2, got ${categoryDelta!.value.weight}.`,
  );

  const sourceDelta = deltas.find((d) => d.key === "source:source-1");
  assert(
    sourceDelta !== undefined,
    "MORE_LIKE_THIS must also produce a source delta.",
  );
  assert(
    sourceDelta!.value.signalCount === 1,
    "MORE_LIKE_THIS source delta must also count once.",
  );
}

// ===== Issue #170 RED: gravityScore 必须分离四个独立维度 =====

function testGravityScoreSeparatesRelevanceAndImportance(): void {
  // 两个 item 相关性相同（relevanceScore=80）但重要性不同（60 vs 90）。
  // 当前 calculateGravityScore 只接一个 baseScore，两者 gravityScore 一定相同 —— 这就是 bug。
  const now = new Date("2026-07-18T00:00:00Z");
  const occurredAt = new Date("2026-07-18T00:00:00Z");
  const scoreLowImportance = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 60,
    sourceQualityFactor: 1,
    occurredAt,
    now,
  });
  const scoreHighImportance = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 90,
    sourceQualityFactor: 1,
    occurredAt,
    now,
  });
  assert(
    scoreLowImportance !== scoreHighImportance,
    "Relevance equal but importance different must yield different gravityScore.",
  );
  assert(
    scoreHighImportance > scoreLowImportance,
    "Higher importance must produce higher gravityScore.",
  );
}

function testGravityScoreSeparatesSourceQualityFactor(): void {
  // 相关性+重要性相同，但来源质量不同（0.5 vs 1.0），gravityScore 应不同。
  const now = new Date("2026-07-18T00:00:00Z");
  const occurredAt = new Date("2026-07-18T00:00:00Z");
  const lowQuality = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 80,
    sourceQualityFactor: 0.5,
    occurredAt,
    now,
  });
  const highQuality = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 80,
    sourceQualityFactor: 1,
    occurredAt,
    now,
  });
  assert(
    lowQuality !== highQuality,
    "Same relevance+importance but different source quality must yield different gravityScore.",
  );
  assert(
    highQuality > lowQuality,
    "Higher source quality factor must produce higher gravityScore.",
  );
}

function testGravityScoreAppliesPreferenceAdjustment(): void {
  // preferenceAdjustment 是第四个独立维度：正偏好应提升 gravityScore。
  const now = new Date("2026-07-18T00:00:00Z");
  const occurredAt = new Date("2026-07-18T00:00:00Z");
  const baseline = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 80,
    sourceQualityFactor: 1,
    occurredAt,
    now,
  });
  const boosted = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 80,
    sourceQualityFactor: 1,
    preferenceAdjustment: 1.3,
    occurredAt,
    now,
  });
  assert(
    boosted > baseline,
    "Positive preference adjustment must increase gravityScore.",
  );
  const reduced = calculateGravityScore({
    relevanceScore: 80,
    importanceScore: 80,
    sourceQualityFactor: 1,
    preferenceAdjustment: 0.7,
    occurredAt,
    now,
  });
  assert(
    reduced < baseline,
    "Negative preference adjustment must decrease gravityScore.",
  );
}

function testRuleDraftEmitsScoringBreakdown(): void {
  // 规则路径 createIntelligenceEventDraft 必须在 draft 上暴露四维度明细。
  const item = {
    fetchedAt: new Date("2026-07-18"),
    id: "rule-breakdown-item",
    summary: "某AI公司发布新模型",
    title: "某AI公司发布新模型",
    topicProfile: {
      keywords: ["AI"],
      entities: ["某AI公司"],
    },
    url: "https://example.com/rule-breakdown",
  };
  const draft = createIntelligenceEventDraft(item);
  assert(draft !== null, "Rule draft must exist for relevant item.");
  assert(
    draft!.scoringBreakdown !== undefined,
    "Rule draft must expose scoringBreakdown.",
  );
  assert(
    typeof draft!.scoringBreakdown!.relevanceScore === "number",
    "scoringBreakdown.relevanceScore must be a number.",
  );
  assert(
    typeof draft!.scoringBreakdown!.importanceScore === "number",
    "scoringBreakdown.importanceScore must be a number.",
  );
  assert(
    typeof draft!.scoringBreakdown!.sourceQualityFactor === "number",
    "scoringBreakdown.sourceQualityFactor must be a number.",
  );
  assert(
    draft!.scoringBreakdown!.preferenceAdjustment === 1,
    "Rule draft preferenceAdjustment defaults to 1 (no preference applied at write time).",
  );
  assert(
    typeof draft!.scoringBreakdown!.scoringVersion === "number" &&
      draft!.scoringBreakdown!.scoringVersion >= 2,
    "scoringBreakdown must carry scoringVersion >= 2.",
  );
}

function testExtractionDraftEmitsScoringBreakdown(): void {
  // AI 路径 createIntelligenceEventDraftFromExtraction 必须从 extraction.importanceScore
  // 传入 scoringBreakdown，且 sourceQualityFactor 由调用方提供。
  const extraction: AiEventExtraction = {
    category: "模型发布",
    entities: ["某AI公司"],
    followUpSuggestion: "",
    importanceExplanation: "新模型在基准测试上领先。",
    isRelevant: true,
    matchedKeywords: ["AI"],
    relevanceScore: 85,
    importanceScore: 92,
    summary: "某AI公司发布新模型，基准测试领先。",
    title: "某AI公司发布新模型",
  };
  const draft = createIntelligenceEventDraftFromExtraction(
    {
      fetchedAt: new Date("2026-07-18"),
      id: "extraction-breakdown-item",
      publishedAt: new Date("2026-07-18"),
      summary: "",
      title: "某AI公司发布新模型",
      topicProfile: { keywords: ["AI"] },
      url: "https://example.com/extraction-breakdown",
    },
    extraction,
    { sourceQualityFactor: 0.8 },
  );
  assert(draft !== null, "Extraction draft must exist for relevant extraction.");
  assert(
    draft!.scoringBreakdown!.importanceScore === 92,
    "scoringBreakdown.importanceScore must come from extraction.importanceScore.",
  );
  assert(
    draft!.scoringBreakdown!.sourceQualityFactor === 0.8,
    "scoringBreakdown.sourceQualityFactor must come from caller option.",
  );
  assert(
    draft!.scoringBreakdown!.relevanceScore === 85,
    "scoringBreakdown.relevanceScore must come from extraction.relevanceScore.",
  );
}

function testLegacyEventResolvesBackwardCompatibleBreakdown(): void {
  // 旧事件 rawAiResponse 没有 scoring 块，resolveScoringBreakdown 必须回退到
  // v1 兼容：importanceScore = relevanceScore（旧 score 字段），sourceQualityFactor = 1。
  const legacyRaw = { mode: "llm", extraction: { relevanceScore: 70 } } as Record<
    string,
    unknown
  >;
  const breakdown = resolveScoringBreakdown({
    rawAiResponse: legacyRaw,
    score: 70,
    gravityScore: 40,
  });
  assert(
    breakdown.scoringVersion === 1,
    "Legacy event without scoring block must resolve to scoringVersion 1.",
  );
  assert(
    breakdown.importanceScore === 70,
    "Legacy event importanceScore must fall back to relevance/score.",
  );
  assert(
    breakdown.sourceQualityFactor === 1,
    "Legacy event sourceQualityFactor must default to 1.",
  );
  assert(
    breakdown.preferenceAdjustment === 1,
    "Legacy event preferenceAdjustment must default to 1.",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
