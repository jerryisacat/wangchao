import { buildEventExtractionMessages, parseEventExtractionResponse } from "./event-extraction.js";
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
  fixtureMissingTitleReturnsNoise();
  fixtureDuplicateTitleThrows();
  fixtureNonChineseSummaryThrows();
  fixturePromptUsesCurrentInterfaceLanguage();
  fixtureThinkingTagsSanitized();
  fixtureTypeEnumMismatchThrows();
  fixtureImportanceScoreParsedWhenPresent();
  fixtureImportanceScoreDefaultsWhenAbsent();
  fixturePromptRequestsImportanceScore();
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
        item: { id: "1", rawContent: "Captured Markdown content for adapter timeout testing.", title: "test", url: "https://example.com" },
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
        item: { id: "1", rawContent: "Captured Markdown content for missing key testing.", title: "test", url: "https://example.com" },
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
    noiseReason: "",
    relevanceScore: 85,
    title: "产品发布",
    summary: "该公司发布了新产品，并披露了具体功能及其潜在影响。",
    category: "产品发布",
    entities: ["OpenAI", "GPT-5"],
    followUpSuggestion: "继续观察产品发布节奏。",
    importanceExplanation: "该进展可能影响相关产品路线。",
    matchedKeywords: ["ai", "agent"],
  });

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Original Title",
  });

  assert(result.isRelevant === true, "Should be relevant.");
  assert(result.relevanceScore === 85, "Score should match.");
  assert(result.title === "产品发布", "Title should match AI output.");
  assert(result.summary === "该公司发布了新产品，并披露了具体功能及其潜在影响。", "Summary should match.");
  assert(result.category === "产品发布", "Category should match.");
  assert(result.importanceExplanation === "该进展可能影响相关产品路线。", "Explanation should match.");
  assert(result.matchedKeywords.length === 2, "Keywords should be parsed.");
  assert(result.entities.length === 2, "Entities should be parsed.");
  assert(result.followUpSuggestion === "继续观察产品发布节奏。", "Follow-up suggestion should match.");
}

function fixtureValidNoiseResponse(): void {
  const content = JSON.stringify({
    isRelevant: false,
    relevanceScore: 0,
    noiseReason: "与主题无关的广告",
    title: "",
    summary: "",
    category: "noise",
    entities: [],
    followUpSuggestion: "",
    importanceExplanation: "",
    matchedKeywords: [],
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
          followUpSuggestion: "",
          importanceExplanation: "Test.",
          matchedKeywords: ["test"],
          noiseReason: "",
        }),
      ),
    "Non-array entities should fail schema validation.",
  );
}

function fixtureMissingTitleReturnsNoise(): void {
  assertThrows(
    () => parseEventExtractionResponse(JSON.stringify({
      isRelevant: true,
      relevanceScore: 80,
      summary: "这是一段有摘要但缺少标题的中文内容。",
      category: "general",
      entities: [],
      followUpSuggestion: "",
      importanceExplanation: "Reason",
      matchedKeywords: [],
      noiseReason: "",
    })),
    "Missing title should fail deterministic quality validation.",
  );
}

function fixtureThinkingTagsSanitized(): void {
  const content = `<think>let me analyze this</think>\n\`\`\`json\n${JSON.stringify(
    {
      isRelevant: true,
      relevanceScore: 78,
      title: "研究进展",
      summary: "研究团队公布了新的实验结果，并说明了相关限制。",
      category: "研究",
      entities: [],
      followUpSuggestion: "",
      importanceExplanation: "Key insight.",
      matchedKeywords: ["ml"],
      noiseReason: "",
    },
  )}\n\`\`\``;

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Fallback",
  });

  assert(result.isRelevant === true, "Should parse through thinking tags.");
  assert(result.title === "研究进展", "Title should be extracted correctly.");
}

function fixtureDuplicateTitleThrows(): void {
  assertThrows(
    () => parseEventExtractionResponse(JSON.stringify({
      isRelevant: true,
      relevanceScore: 90,
      noiseReason: "",
      title: "Grok 将用户目录上传至 xAI 服务器",
      summary: "Grok 将用户目录上传至 xAI 服务器",
      category: "安全",
      entities: ["Grok", "xAI"],
      followUpSuggestion: "继续跟踪后续披露。",
      importanceExplanation: "此事可能影响用户隐私。",
      matchedKeywords: ["AI"],
    }), {
      itemTitle: "Grok 将用户目录上传至 xAI 服务器",
    }),
    "A summary that repeats the source title must be rejected.",
  );
}

function fixtureNonChineseSummaryThrows(): void {
  assertThrows(
    () => parseEventExtractionResponse(JSON.stringify({
      isRelevant: true,
      relevanceScore: 82,
      noiseReason: "",
      title: "English only title",
      summary: "This English-only summary has enough characters but violates the requested language.",
      category: "general",
      entities: [],
      followUpSuggestion: "Keep watching.",
      importanceExplanation: "It matters.",
      matchedKeywords: [],
    }), {
      itemTitle: "Different source title",
    }),
    "The current Chinese interface must reject summaries without Chinese text.",
  );
}

function fixturePromptUsesCurrentInterfaceLanguage(): void {
  const baseInput = {
    item: {
      id: "1",
      rawContent: "# Evidence\n\nThe captured document contains enough factual evidence for extraction.",
      title: "Source title",
      url: "https://example.com/article",
    },
    topic: { keywords: ["AI"], name: "AI" },
  };
  const english = buildEventExtractionMessages({
    ...baseInput,
    topic: { ...baseInput.topic, languagePreferences: { outputLanguage: "en" } },
  }).map((message) => message.content).join("\n");
  const chinese = buildEventExtractionMessages({
    ...baseInput,
    topic: { ...baseInput.topic, languagePreferences: { outputLanguage: "zh-CN" } },
  }).map((message) => message.content).join("\n");
  assert(english.includes("简体中文"), "An English topic preference must still follow the current Chinese interface language.");
  assert(!english.includes("English summary"), "Topic preferences must not override the interface summary language.");
  assert(chinese.includes("简体中文"), "The default prompt should request Simplified Chinese consistently.");
  assert(chinese.includes("documentMarkdown"), "Prompt should identify Markdown as the factual document.");
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

// ===== Issue #170 RED: parser 必须解析 importanceScore 独立维度 =====

function fixtureImportanceScoreParsedWhenPresent(): void {
  const content = JSON.stringify({
    isRelevant: true,
    noiseReason: "",
    relevanceScore: 70,
    importanceScore: 92,
    title: "政策变化",
    summary: "监管机构发布新规，影响行业格局与相关企业。",
    category: "政策",
    entities: ["监管机构"],
    followUpSuggestion: "",
    importanceExplanation: "新规影响行业格局。",
    matchedKeywords: [],
  });

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Original",
  });

  assert(
    result.importanceScore === 92,
    "importanceScore must be parsed when AI returns it.",
  );
  assert(
    result.relevanceScore === 70,
    "relevanceScore and importanceScore must remain independent.",
  );
}

function fixtureImportanceScoreDefaultsWhenAbsent(): void {
  // 旧格式 / 老 model 不返回 importanceScore 时，parser 必须给出安全默认值
  // （等于 relevanceScore，保持向后兼容），而不是 undefined。
  const content = JSON.stringify({
    isRelevant: true,
    noiseReason: "",
    relevanceScore: 75,
    title: "默认重要性",
    summary: "某事件发生，涉及具体主体与影响。",
    category: "一般",
    entities: [],
    followUpSuggestion: "",
    importanceExplanation: "",
    matchedKeywords: [],
  });

  const result = parseEventExtractionResponse(content, {
    itemTitle: "Original",
  });

  assert(
    typeof result.importanceScore === "number",
    "importanceScore must always be a number even when AI omits it.",
  );
  assert(
    result.importanceScore === 75,
    "Absent importanceScore must default to relevanceScore for backward compatibility.",
  );
}

function fixturePromptRequestsImportanceScore(): void {
  const messages = buildEventExtractionMessages({
    item: {
      id: "1",
      rawContent: "# Evidence\n\nDocument content.",
      title: "Source",
      url: "https://example.com/x",
    },
    topic: { keywords: ["AI"], name: "AI" },
  });
  const combined = messages.map((m) => m.content).join("\n");
  assert(
    combined.includes("importanceScore"),
    "Prompt must explicitly request an importanceScore field from the model.",
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
