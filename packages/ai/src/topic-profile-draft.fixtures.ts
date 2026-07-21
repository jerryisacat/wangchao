import {
  buildTopicProfileDraftMessages,
  fallbackTopicProfileDraft,
  parseTopicProfileDraftResponse,
  generateTopicProfileDraft,
  type TopicProfileDraftAdapter,
  type TopicProfileDraftInput,
} from "./topic-profile-draft.js";

export async function runTopicProfileDraftFixtures(): Promise<void> {
  fixturePromptCarriesNaturalLanguageInput();
  fixtureParserSanitizesAndClampsLists();
  fixtureParserRejectsMissingRequiredField();
  fixtureFallbackProducesExplainableRulesMode();
  fixtureGenerateUsesAdapterAndMarksAiMode();
  fixtureGenerateThrowsOnAdapterFailure();
  fixtureSchemaVersionIsStable();
}

function fixturePromptCarriesNaturalLanguageInput(): void {
  const input: TopicProfileDraftInput = {
    description: "关注中国商业航空，C919/C929/ARJ21、适航认证、供应链、航司订单。",
    name: "中国商业航空进展",
  };
  const messages = buildTopicProfileDraftMessages(input);
  assert(messages.length === 2, "Draft prompt must have system + user messages.");
  const userMessage = messages[1];
  assert(userMessage !== undefined, "User message must exist.");
  const userPayload = JSON.stringify(userMessage);
  assert(
    userPayload.includes("中国商业航空进展"),
    "Prompt must echo the topic name back to the model.",
  );
  assert(
    userPayload.includes("C919"),
    "Prompt must carry the natural-language description terms.",
  );
  assert(
    messages[0] !== undefined && messages[0].content.includes("JSON"),
    "System message must request strict JSON.",
  );
}

function fixtureParserSanitizesAndClampsLists(): void {
  const payload = JSON.stringify({
    schemaVersion: 1,
    name: "  中国商业航空进展  ",
    keywords: ["C919", "C919", "  适航认证  ", "<script>x</script>", "x".repeat(400)],
    entities: ["COMAC", "COMAC", "中国商飞"],
    includeScope: ["C919 / C929 / ARJ21", ""],
    excludeScope: ["普通航班延误", "航旅服务营销"],
    importanceRules: [
      "官方公告优先",
      "一手研究优先",
      "降低纯观点权重",
    ],
    languagePreferences: {
      outputLanguage: "  zh-CN  ",
      terminologyRules: ["OpenAI 不译", "LLM 保留英文"],
    },
    digestStyle: {
      structure: "standard",
      detailLevel: "standard",
      maxEvents: 10,
    },
  });

  const draft = parseTopicProfileDraftResponse(payload);

  assert(draft.schemaVersion === 1, "Parser must keep schemaVersion=1.");
  assert(draft.name === "中国商业航空进展", "Parser must trim name.");
  assert(
    draft.keywords[0] === "C919" && draft.keywords.length === 3,
    `Parser must dedupe and sanitize keywords, got: ${JSON.stringify(draft.keywords)}`,
  );
  assert(
    !draft.keywords.some((k) => k.includes("<")),
    "Parser must strip HTML from keyword entries.",
  );
  assert(
    draft.keywords.every((k) => k.length <= 200),
    "Parser must clamp overly long keyword entries.",
  );
  assert(
    draft.entities.join(",") === "COMAC,中国商飞",
    `Parser must dedupe entities, got: ${JSON.stringify(draft.entities)}`,
  );
  assert(
    draft.includeScope.length === 1 && draft.includeScope[0] === "C919 / C929 / ARJ21",
    "Parser must drop empty includeScope entries.",
  );
  assert(
    draft.languagePreferences.outputLanguage === "zh-CN",
    "Parser must trim outputLanguage.",
  );
  assert(
    draft.digestStyle.maxEvents === 10,
    "Parser must keep valid maxEvents.",
  );
}

function fixtureParserRejectsMissingRequiredField(): void {
  assertThrows(
    () =>
      parseTopicProfileDraftResponse(
        JSON.stringify({ schemaVersion: 1, name: "x" }),
      ),
    "Missing keywords/entities/scope fields must fail validation.",
  );
  assertThrows(
    () =>
      parseTopicProfileDraftResponse(
        JSON.stringify({
          schemaVersion: 2,
          name: "x",
          keywords: ["a"],
          entities: [],
          includeScope: [],
          excludeScope: [],
          importanceRules: [],
          languagePreferences: { outputLanguage: "zh-CN", terminologyRules: [] },
          digestStyle: { structure: "standard", detailLevel: "standard", maxEvents: 10 },
        }),
      ),
    "Unsupported schemaVersion must be rejected so workers see a stable contract.",
  );
}

function fixtureFallbackProducesExplainableRulesMode(): void {
  const input: TopicProfileDraftInput = {
    description: "跟踪 OpenAI、Anthropic 等模型供应商的发布与定价。",
    name: "AI 模型供应商",
  };
  const draft = fallbackTopicProfileDraft(input);

  assert(
    draft.generationMode === "rules",
    "Fallback must be marked as rules mode.",
  );
  assert(draft.schemaVersion === 1, "Fallback must pin schemaVersion=1.");
  assert(
    draft.keywords.some((k) => k.toLowerCase().includes("openai") || k.includes("模型")),
    "Fallback keywords must come from natural-language input.",
  );
  assert(
    draft.excludeScope.length > 0 && draft.importanceRules.length > 0,
    "Fallback must supply non-empty exclude scope and importance rules.",
  );
  assert(
    draft.languagePreferences.outputLanguage === "zh-CN",
    "Fallback must default to zh-CN.",
  );
}

async function fixtureGenerateUsesAdapterAndMarksAiMode(): Promise<void> {
  const adapter: TopicProfileDraftAdapter = {
    async chat() {
      return {
        content: JSON.stringify({
          schemaVersion: 1,
          name: "中国商业航空进展",
          keywords: ["C919", "C929", "ARJ21", "适航认证", "COMAC"],
          entities: ["COMAC", "中国商飞", "民航局"],
          includeScope: ["C919 / C929 / ARJ21 商业运营", "适航认证与监管政策"],
          excludeScope: ["普通航班延误", "航旅服务营销", "招聘与乘务员新闻"],
          importanceRules: ["官方公告与一手研究优先", "降低纯转载与无来源内容权重"],
          languagePreferences: {
            outputLanguage: "zh-CN",
            terminologyRules: ["COMAC 保留英文", "C919 不译"],
          },
          digestStyle: {
            structure: "standard",
            detailLevel: "standard",
            maxEvents: 12,
          },
        }),
        raw: {},
      };
    },
  };

  const draft = await generateTopicProfileDraft(
    {
      description: "关注中国商业航空进展。",
      name: "中国商业航空进展",
    },
    { adapter, model: "fixture-model" },
  );

  assert(draft.generationMode === "ai", "Generated draft must be marked ai mode.");
  assert(
    draft.entities.includes("COMAC"),
    "Generated draft must preserve AI entities.",
  );
  assert(
    draft.digestStyle.maxEvents === 12,
    "Generated draft must keep AI-chosen maxEvents.",
  );
}

async function fixtureGenerateThrowsOnAdapterFailure(): Promise<void> {
  const adapter: TopicProfileDraftAdapter = {
    async chat() {
      throw new Error("upstream provider down");
    },
  };

  let threw = false;
  try {
    await generateTopicProfileDraft(
      { description: "x", name: "x" },
      { adapter, model: "fixture-model" },
    );
  } catch {
    threw = true;
  }
  assert(threw, "generateTopicProfileDraft must propagate adapter errors so callers can fall back.");
}

function fixtureSchemaVersionIsStable(): void {
  const draft = fallbackTopicProfileDraft({ description: "", name: "稳定性测试" });
  assert(
    draft.schemaVersion === 1,
    "schemaVersion must stay 1 until a breaking contract change is intentional.",
  );
  assert(
    draft.source === "topic-profile-generator",
    "source must keep identifying the generator for downstream observability.",
  );
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}
