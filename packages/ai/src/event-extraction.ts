import { parseJsonObject, validateJsonObject } from "./parser.js";
import type { AiChatMessage, JsonSchema } from "./types.js";

export interface EventExtractionInput {
  item: {
    id: string;
    title: string;
    summary?: string | null;
    url: string;
    publishedAt?: string | null;
    sourceName?: string | null;
    rawContent?: string | null;
  };
  topic: {
    description?: string | null;
    entities?: string[];
    excludeScope?: string[];
    importanceRules?: string[];
    includeScope?: string[];
    keywords: string[];
    name: string;
    languagePreferences?: {
      outputLanguage: string;
      terminologyRules?: string[];
    };
  };
}

export interface EventExtractionResult {
  category: string;
  entities: string[];
  followUpSuggestion: string;
  importanceExplanation: string;
  isRelevant: boolean;
  matchedKeywords: string[];
  noiseReason?: string;
  raw: Record<string, unknown>;
  relevanceScore: number;
  summary: string;
  title: string;
}

export interface EventExtractionAdapter {
  chat(request: {
    jsonMode?: boolean;
    maxTokens?: number;
    messages: AiChatMessage[];
    model: string;
    temperature?: number;
  }): Promise<{ content: string; raw: unknown }>;
}

const EVENT_EXTRACTION_SCHEMA: JsonSchema = {
  required: [
    "isRelevant",
    "relevanceScore",
    "noiseReason",
    "title",
    "summary",
    "category",
    "entities",
    "followUpSuggestion",
    "importanceExplanation",
    "matchedKeywords",
  ],
  properties: {
    category: { type: "string" },
    entities: { type: "array" },
    followUpSuggestion: { type: "string" },
    importanceExplanation: { type: "string" },
    isRelevant: { type: "boolean" },
    matchedKeywords: { type: "array" },
    noiseReason: { type: "string" },
    relevanceScore: { type: "number" },
    summary: { type: "string" },
    title: { type: "string" },
  },
};

export function buildEventExtractionMessages(
  input: EventExtractionInput,
): AiChatMessage[] {
  const lang = input.topic.languagePreferences?.outputLanguage ?? "zh-CN";
  const isEnglish = lang.toLowerCase().startsWith("en");
  const langInstruction =
    isEnglish
      ? "Write every user-facing field in English."
      : "Write every user-facing field in Simplified Chinese (zh-CN), while preserving proper nouns.";
  const termRules =
    input.topic.languagePreferences?.terminologyRules?.length
      ? `\nFollow these terminology rules: ${input.topic.languagePreferences.terminologyRules.join("; ")}.`
      : "";

  return [
    {
      role: "system",
      content:
        `You filter and extract intelligence events for a topic-driven workspace. Return strict JSON only. The captured Markdown document is the only factual basis. Never infer facts absent from that document. Treat allegations, personal reports, and unverified claims as claims and preserve attribution (for example, "作者称" or "据称" in Chinese). A relevant summary must add information beyond the source title and must never merely copy, paraphrase, or translate that title. If the item is irrelevant noise, set isRelevant=false. Always return every schema field, using empty strings/arrays for non-applicable fields. ${langInstruction}${termRules}`,
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction: isEnglish
          ? "Decide whether the captured Markdown is relevant to the topic. If relevant, write a concise 1-2 sentence English summary covering who or what acted, what happened, the concrete impact or risk, and attribution/uncertainty when applicable. Also return a clean title, short category, relevance score 0-100, matched keywords, entities, importance explanation, and follow-up suggestion. If irrelevant, set isRelevant=false and provide a brief English noiseReason."
          : "判断采集到的 Markdown 是否与主题相关。若相关，用 1-2 句简体中文概括行动主体、发生的事情、具体影响或风险，并在适用时保留“作者称/据称”等归因与不确定性；同时返回清理后的标题、短分类、0-100 相关性分数、命中关键词、实体、重要性解释与后续建议。若不相关，设置 isRelevant=false 并用简体中文提供简短 noiseReason。",
        outputSchema: {
          isRelevant: "boolean",
          relevanceScore: "number, 0-100",
          noiseReason: `string, ${isEnglish ? "English" : "Simplified Chinese"}; empty when relevant`,
          title: `string, cleaned title in ${isEnglish ? "English" : "Simplified Chinese"}`,
          summary: `string, concise 1-2 sentence ${isEnglish ? "English" : "Simplified Chinese"} summary grounded only in documentMarkdown`,
          category: `string, short ${isEnglish ? "English" : "Simplified Chinese"} category label`,
          entities: "array of relevant entity names (people, organizations, products) mentioned. max 10 items.",
          followUpSuggestion: `string, one sentence in ${isEnglish ? "English" : "Simplified Chinese"}, or empty string`,
          importanceExplanation: `string, one sentence in ${isEnglish ? "English" : "Simplified Chinese"}`,
          matchedKeywords: "array of matched topic keywords",
        },
        topic: {
          name: input.topic.name,
          description: input.topic.description,
          keywords: input.topic.keywords,
          entities: input.topic.entities ?? [],
          includeScope: input.topic.includeScope ?? [],
          excludeScope: input.topic.excludeScope ?? [],
          importanceRules: input.topic.importanceRules ?? [],
        },
        item: {
          title: input.item.title,
          url: input.item.url,
          publishedAt: input.item.publishedAt,
          sourceName: input.item.sourceName,
          documentMarkdown: input.item.rawContent?.slice(0, 8_000) ?? "",
          documentTruncated: (input.item.rawContent?.length ?? 0) > 8_000,
        },
      }),
    },
  ];
}

export async function extractEvent(
  input: EventExtractionInput,
  options: {
    adapter: EventExtractionAdapter;
    maxTokens?: number;
    model: string;
    temperature?: number;
  },
): Promise<EventExtractionResult> {
  if (!input.item.rawContent?.trim()) {
    throw new Error("Event extraction requires captured Markdown content.");
  }
  const response = await options.adapter.chat({
    jsonMode: true,
    maxTokens: options.maxTokens ?? 600,
    messages: buildEventExtractionMessages(input),
    model: options.model,
    temperature: options.temperature ?? 0.2,
  });

  return parseEventExtractionResponse(response.content, {
    itemTitle: input.item.title,
    outputLanguage: input.topic.languagePreferences?.outputLanguage ?? "zh-CN",
  });
}

export function parseEventExtractionResponse(
  content: string,
  context?: { itemTitle?: string; outputLanguage?: string },
): EventExtractionResult {
  const parsed = parseJsonObject(content);
  const validation = validateJsonObject(parsed, EVENT_EXTRACTION_SCHEMA);

  if (!validation.ok) {
    throw new Error(
      `Invalid event extraction JSON: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const isRelevant = Boolean(parsed.isRelevant);

  if (!isRelevant) {
    return {
      category: "noise",
      entities: [],
      followUpSuggestion: "",
      importanceExplanation: "",
      isRelevant: false,
      matchedKeywords: Array.isArray(parsed.matchedKeywords)
        ? parsed.matchedKeywords.filter((v): v is string => typeof v === "string")
        : [],
      noiseReason: sanitizeNoiseReason(
        parsed.noiseReason !== undefined ? String(parsed.noiseReason) : undefined,
      ),
      raw: parsed,
      relevanceScore: 0,
      summary: "",
      title: "",
    };
  }

  const rawScore = Number(parsed.relevanceScore);
  const relevanceScore = Number.isFinite(rawScore) ? clamp(rawScore, 0, 100) : 0;
  const matchedKeywords = Array.isArray(parsed.matchedKeywords)
    ? parsed.matchedKeywords.filter((v): v is string => typeof v === "string")
    : [];
  const entities = Array.isArray(parsed.entities)
    ? parsed.entities.filter((v): v is string => typeof v === "string").slice(0, 10)
    : [];
  const followUpSuggestion =
    typeof parsed.followUpSuggestion === "string"
      ? parsed.followUpSuggestion.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

  const title = sanitizeTextField(parsed.title, "", 200);
  const summary = sanitizeTextField(parsed.summary, "", 1000);
  const category = sanitizeTextField(parsed.category, "general", 50);
  const importanceExplanation = sanitizeTextField(
    parsed.importanceExplanation,
    "",
    500,
  );

  validateRelevantExtractionQuality({
    outputLanguage: context?.outputLanguage ?? "zh-CN",
    sourceTitle: context?.itemTitle ?? "",
    summary,
    title,
  });

  return {
    category,
    entities,
    followUpSuggestion,
    importanceExplanation,
    isRelevant: true,
    matchedKeywords,
    raw: parsed,
    relevanceScore,
    summary,
    title,
  };
}

function validateRelevantExtractionQuality(input: {
  outputLanguage: string;
  sourceTitle: string;
  summary: string;
  title: string;
}): void {
  if (!input.title || !input.summary) {
    throw new Error("AI returned isRelevant=true with an empty title or summary.");
  }

  const compactSummary = input.summary.replace(/[\s\p{P}\p{S}]/gu, "");
  if (compactSummary.length < 12) {
    throw new Error("AI summary is too short to be useful.");
  }

  if (!input.outputLanguage.toLowerCase().startsWith("en") && !/[\u3400-\u9fff]/u.test(input.summary)) {
    throw new Error("AI summary does not match the requested Chinese output language.");
  }

  if (isHighlySimilar(input.sourceTitle, input.summary)) {
    throw new Error("AI summary duplicates or closely mirrors the source title.");
  }
}

function isHighlySimilar(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if ((a.includes(b) || b.includes(a)) && shorter / longer >= 0.8) return true;
  if (shorter < 2) return false;

  const bigrams = (value: string) => {
    const counts = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return counts;
  };
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  let overlap = 0;
  for (const [pair, count] of leftPairs) {
    overlap += Math.min(count, rightPairs.get(pair) ?? 0);
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1) >= 0.82;
}

export function fallbackEventExtraction(
  input: EventExtractionInput,
): EventExtractionResult {
  return {
    category: "noise",
    entities: [],
    followUpSuggestion: "",
    importanceExplanation: "AI 提取不可用，无法评估相关性，默认标记为不相关。",
    isRelevant: false,
    matchedKeywords: [],
    raw: {
      mode: "deterministic-fallback",
      reason: "AI extraction unavailable or failed, using rules-based fallback.",
    },
    relevanceScore: 0,
    summary: "",
    title: "",
  };
}

function sanitizeNoiseReason(value: string | undefined): string {
  if (!value) {
    return "AI判定为不相关内容。";
  }
  return value
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function sanitizeTextField(value: unknown, fallback: string, maxLength = 500): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
