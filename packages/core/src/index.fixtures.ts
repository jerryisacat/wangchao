import {
  buildRuleFallbackSummary,
  createIntelligenceEventDraft,
  evaluateRelevance,
} from "./index.js";

export function runCoreFixtures(): void {
  testRuleFallbackSummaryCleansRssMetadata();
  testRuleFallbackSummaryUsesTitleWhenSummaryIsPureMetadata();
  testRuleFallbackSummaryUsesCleanSummaryWhenPresent();
  testRuleFallbackSummaryFallsBackToTitle();
  testCreateIntelligenceEventDraftUsesCleanSummary();
  testCreateIntelligenceEventDraftReturnsNullForIrrelevant();
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
