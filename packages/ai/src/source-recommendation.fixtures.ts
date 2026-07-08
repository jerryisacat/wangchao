import {
  buildSourceRecommendationMessages,
  fallbackSourceRecommendation,
  parseSourceRecommendationResponse,
  recommendSourceCandidate,
} from "./source-recommendation.js";

export async function runSourceRecommendationFixtures(): Promise<void> {
  const input = {
    evidence: {
      channel: "keyword-search",
    },
    sourceName: "Example AI Policy",
    sourceUrl: "https://example.com/feed.xml",
    topicDescription: "Track AI regulation.",
    topicKeywords: ["AI", "policy"],
    topicName: "AI Regulation",
  };
  const messages = buildSourceRecommendationMessages(input);
  const recommendation = parseSourceRecommendationResponse(
    `{"reason":"<b>该源持续发布 AI 政策更新，适合作为候选源观察。</b>","relevanceScore":1.2}`,
  );
  const adapterRecommendation = await recommendSourceCandidate(input, {
    adapter: {
      async chat() {
        return {
          content:
            '{"reason":"该源覆盖主题关键词，可补充一手更新。","relevanceScore":0.82}',
          raw: {},
        };
      },
    },
    model: "fixture-model",
  });
  const fallback = fallbackSourceRecommendation(input);

  assert(messages.length === 2, "Recommendation prompt should have two messages.");
  assert(recommendation.relevanceScore === 1, "Recommendation score should clamp.");
  assert(!recommendation.reason.includes("<"), "Recommendation reason should sanitize HTML.");
  assert(adapterRecommendation.relevanceScore === 0.82, "Adapter path should parse JSON.");
  assert(fallback.relevanceScore > 0, "Fallback recommendation should score source.");
  assertThrows(
    () => parseSourceRecommendationResponse('{"reason":"","relevanceScore":0.5}'),
    "Empty reason should be rejected.",
  );
  assertThrows(
    () => parseSourceRecommendationResponse('{"reason":"ok"}'),
    "Missing relevance score should be rejected.",
  );
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }

  throw new Error(message);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
