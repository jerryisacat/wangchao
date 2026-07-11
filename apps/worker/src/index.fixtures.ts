import { resolveFilteredNoiseReason } from "./index.js";

export function runWorkerFixtures(): void {
  const ruleReason = resolveFilteredNoiseReason({
    llmNoiseReason: "LLM marked this as noise.",
    ruleDecision: {
      isRelevant: false,
      matchedEntities: [],
      matchedExcludeScopes: ["招聘广告"],
      matchedIncludeScopes: [],
      matchedKeywords: ["AI"],
      noiseReason: "Matched excluded topic scope: 招聘广告.",
      score: 0,
    },
    usedFallback: true,
  });
  assert(
    ruleReason === "Matched excluded topic scope: 招聘广告.",
    "A fallback rule reason must take priority over the failed LLM attempt.",
  );

  const llmReason = resolveFilteredNoiseReason({
    llmNoiseReason: "内容与主题不相关。",
    ruleDecision: null,
    usedFallback: false,
  });
  assert(
    llmReason === "内容与主题不相关。",
    "A successful LLM noise decision must retain its provider reason.",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
