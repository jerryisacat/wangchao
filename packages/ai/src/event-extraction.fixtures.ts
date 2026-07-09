import { parseEventExtractionResponse } from "./event-extraction.js";
import type { EventExtractionAdapter } from "./event-extraction.js";
import { extractEvent } from "./event-extraction.js";

export async function runEventExtractionFixtures(): Promise<void> {
  fixtureMalformedJsonThrows();
  fixtureEmptyResponseThrows();
  fixtureSchemaMismatchThrows();
  await fixtureTimeoutHandledByAdapter();
  await fixtureNoKeyFallsBack();
  fixtureValidRelevantResponse();
  fixtureValidNoiseResponse();
  fixtureEntitiesArrayParsing();
  fixtureMissingTitleThrows();
  fixtureThinkingTagsSanitized();
  fixtureTypeEnumMismatchThrows();
}

function fixtureMalformedJsonThrows(): void {
  assertThrows(
    () => parseEventExtractionResponse("this is not json at all"),
    "Malformed JSON should throw.",
  );
}

function fixtureEmptyResponseThrows(): void {
  assertThrows(
    () => parseEventExtractionResponse(""),
    "Empty response should throw.",
  );
}

function fixtureSchemaMismatchThrows(): void {
  assertThrows(
    () => parseEventExtractionResponse(JSON.stringify({ foo: "bar" })),
    "Missing isRelevant should throw.",
  );
}

async function fixtureTimeoutHandledByAdapter(): Promise<void> {
  const adapter: EventExtractionAdapter = {
    async chat() {
      throw new Error("simulated timeout");
    },
  };

  let caught = false;
  try {
    await extractEvent(
      {
        item: { id: "1", title: "test", url: "https://example.com" },
        topic: { keywords: [], name: "test" },
      },
      { adapter, model: "gpt-4o-mini" },
    );
  } catch {
    caught = true;
  }

  assert(caught, "Adapter timeout should propagate as error.");
}

async function fixtureNoKeyFallsBack(): Promise<void> {
  let called = false;
  const adapter: EventExtractionAdapter = {
    async chat() {
      called = true;
      throw new Error("no key configured");
    },
  };

  try {
    await extractEvent(
      {
        item: { id: "1", title: "test", url: "https://example.com" },
        topic: { keywords: [], name: "test" },
      },
      { adapter, model: "gpt-4o-mini" },
    );
  } catch {
    // expected — caller should fallback
  }

  assert(called, "Adapter should be called when attempting extraction.");
}

function fixtureValidRelevantResponse(): void {
  const content = JSON.stringify({
    isRelevant: true,
    relevanceScore: 85,
    title: "Clean Title",
    summary: "This is a concise summary.",
    category: "release",
    entities: ["OpenAI", "GPT-5"],
    followUpSuggestion: "继续观察产品发布节奏。",
    importanceExplanation: "Matters because of X.",
    matchedKeywords: ["ai", "agent"],
  });

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Original Title",
    itemSummary: "Original summary.",
  });

  assert(result.isRelevant === true, "Should be relevant.");
  assert(result.relevanceScore === 85, "Score should match.");
  assert(result.title === "Clean Title", "Title should match AI output.");
  assert(result.summary === "This is a concise summary.", "Summary should match.");
  assert(result.category === "release", "Category should match.");
  assert(result.importanceExplanation === "Matters because of X.", "Explanation should match.");
  assert(result.matchedKeywords.length === 2, "Keywords should be parsed.");
  assert(result.entities.length === 2, "Entities should be parsed.");
  assert(result.followUpSuggestion === "继续观察产品发布节奏。", "Follow-up suggestion should match.");
}

function fixtureValidNoiseResponse(): void {
  const content = JSON.stringify({
    isRelevant: false,
    noiseReason: "与主题无关的广告",
  });

  const result = parseEventExtractionResponse(content);

  assert(result.isRelevant === false, "Should be not relevant.");
  assert(result.noiseReason === "与主题无关的广告", "Noise reason should match.");
  assert(result.relevanceScore === 0, "Score should be 0 for noise.");
  assert(result.title === "", "Title should be empty for noise.");
  assert(result.summary === "", "Summary should be empty for noise.");
}

function fixtureEntitiesArrayParsing(): void {
  assertThrows(
    () =>
      parseEventExtractionResponse(
        JSON.stringify({
          isRelevant: true,
          relevanceScore: 80,
          title: "Test Title",
          summary: "Test summary.",
          category: "general",
          entities: "not-an-array",
          importanceExplanation: "Test.",
          matchedKeywords: ["test"],
        }),
      ),
    "Non-array entities should fail schema validation.",
  );
}

function fixtureMissingTitleThrows(): void {
  assertThrows(
    () =>
      parseEventExtractionResponse(
        JSON.stringify({
          isRelevant: true,
          relevanceScore: 80,
          summary: "Has summary but no title",
        }),
      ),
    "Missing title when isRelevant=true should throw.",
  );
}

function fixtureThinkingTagsSanitized(): void {
  const content = `<think>let me analyze this</think>\n\`\`\`json\n${JSON.stringify(
    {
      isRelevant: true,
      relevanceScore: 78,
      title: "Thoughtful Title",
      summary: "After thinking hard.",
      category: "research",
      importanceExplanation: "Key insight.",
      matchedKeywords: ["ml"],
    },
  )}\n\`\`\``;

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Fallback",
    itemSummary: "Fallback",
  });

  assert(result.isRelevant === true, "Should parse through thinking tags.");
  assert(result.title === "Thoughtful Title", "Title should be extracted correctly.");
}

function fixtureTypeEnumMismatchThrows(): void {
  assertThrows(
    () =>
      parseEventExtractionResponse(
        JSON.stringify({ isRelevant: "yes" }),
      ),
    "String instead of boolean should throw.",
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
