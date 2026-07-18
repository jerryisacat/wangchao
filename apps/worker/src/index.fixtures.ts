import { canUseCapturedContentForLlm, mapFetchedSourceItem, resolveFilteredNoiseReason } from "./index.js";
import { runOrganizationCycleFixtures } from "./modules/organization-cycle.fixtures.js";
import { runTaskRunConsumerFixtures } from "./modules/task-run-consumer.fixtures.js";
import { runMainCycleOrchestratorFixtures } from "./modules/main-cycle.fixtures.js";
import { runFetchDispatchFixtures } from "./modules/fetch.fixtures.js";
import { TelegramDeliveryError, escapeTelegramHtml, formatEventForInstantPush, sendTelegramMessage, truncateTelegramMessage } from "./telegram.js";

export async function runWorkerFixtures(): Promise<void> {
  await runTaskRunConsumerFixtures();
  await runOrganizationCycleFixtures();
  await runMainCycleOrchestratorFixtures();
  await runFetchDispatchFixtures();
  const embedded = mapFetchedSourceItem(
    { id: "source-1", organizationId: "org-1", topicId: "topic-1", name: "Source", url: "https://example.com/feed" },
    {
      canonicalUrl: "https://example.com/item",
      contentHash: "hash",
      contentSource: "RSS_EMBEDDED",
      contentStatus: "READY",
      rawContent: "# Captured article\n\nMarkdown body.",
      rawMetadata: {},
      title: "Article",
      url: "https://example.com/item",
    },
    { candidateObservation: true },
  );
  assert(embedded.rawContent?.includes("Markdown body") === true, "Worker persistence mapping must retain RSS Markdown.");
  assert(embedded.contentStatus === "READY", "Worker persistence mapping must retain content status.");
  assert(embedded.contentSource === "RSS_EMBEDDED", "Worker persistence mapping must retain content source.");
  assert(embedded.rawMetadata?.candidateObservation === true, "Candidate observation mapping must retain its audit marker.");

  assert(
    canUseCapturedContentForLlm("READY", "# Captured\n\nVerified Markdown body."),
    "READY Markdown should be eligible for LLM extraction.",
  );
  assert(
    !canUseCapturedContentForLlm("READY", ""),
    "READY without Markdown must not call the LLM.",
  );
  for (const status of ["PENDING", "INSUFFICIENT", "FETCH_FAILED", "UNSUPPORTED"] as const) {
    assert(
      !canUseCapturedContentForLlm(status, "Untrusted fallback text"),
      `${status} content must not call the LLM.`,
    );
  }

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

  const instantMessage = formatEventForInstantPush({
    title: "<重大> & 更新",
    summary: "摘要包含 <script> 与 & 字符。",
    topicName: "AI & Agent",
    sourceName: "Example <News>",
    sourceUrl: "javascript:alert(1)",
    score: 90,
  });
  assert(!instantMessage.includes("<script>"), "Instant push content must be HTML escaped.");
  assert(!instantMessage.includes("javascript:"), "Unsafe source URLs must be omitted.");
  assert(escapeTelegramHtml("<&>") === "&lt;&amp;&gt;", "Telegram HTML escaping must be stable.");
  assert(truncateTelegramMessage("x".repeat(5000)).length <= 4000, "Telegram messages must fit the API limit.");
  assert(formatEventForInstantPush({ title: "t".repeat(1000), summary: "s".repeat(5000), topicName: "topic", sourceName: "source", sourceUrl: "https://example.com", score: 98 }).length <= 4000, "Instant push HTML must remain valid without slicing tags.");
  await testTelegramRateLimitClassification();

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

async function testTelegramRateLimitClassification(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 2 } }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
  try {
    await sendTelegramMessage("test-token", "test-chat", "test");
    throw new Error("Expected Telegram 429 to fail.");
  } catch (error) {
    assert(error instanceof TelegramDeliveryError, "Telegram errors must use the typed boundary.");
    assert(error.retryable, "Telegram 429 must be retryable.");
    assert(error.retryAfterMs === 2000, "Telegram retry_after must be converted to milliseconds.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}