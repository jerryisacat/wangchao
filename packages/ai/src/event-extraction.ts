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
  };
  topic: {
    description?: string | null;
    entities?: string[];
    excludeScope?: string[];
    importanceRules?: string[];
    includeScope?: string[];
    keywords: string[];
    name: string;
  };
}

export interface EventExtractionResult {
  category: string;
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
  required: ["isRelevant"],
  properties: {
    category: { type: "string" },
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
  return [
    {
      role: "system",
      content:
        "You filter and extract intelligence events for a topic-driven workspace. Return strict JSON only. If the item is irrelevant noise, set isRelevant=false. Otherwise set isRelevant=true and fill extraction fields.",
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction:
          "Decide if this item is relevant to the topic. If relevant: write a concise Chinese summary (1-2 sentences), a clean title, a short category label, score relevance 0-100, list matched topic keywords, and explain why it matters in one sentence. If irrelevant: set isRelevant=false and give a brief noiseReason in Chinese.",
        outputSchema: {
          isRelevant: "boolean",
          relevanceScore: "number, 0-100",
          noiseReason: "string, required when isRelevant=false",
          title: "string, cleaned title",
          summary: "string, concise Chinese summary",
          category: "string, short category label",
          importanceExplanation: "string, one sentence",
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
          summary: input.item.summary,
          url: input.item.url,
          publishedAt: input.item.publishedAt,
          sourceName: input.item.sourceName,
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
  const response = await options.adapter.chat({
    jsonMode: true,
    maxTokens: options.maxTokens ?? 600,
    messages: buildEventExtractionMessages(input),
    model: options.model,
    temperature: options.temperature ?? 0.2,
  });

  return parseEventExtractionResponse(response.content, {
    itemSummary: input.item.summary ?? "",
    itemTitle: input.item.title,
  });
}

export function parseEventExtractionResponse(
  content: string,
  fallback?: { itemTitle?: string; itemSummary?: string },
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

  const relevanceScore = clamp(Number(parsed.relevanceScore), 0, 100);
  const matchedKeywords = Array.isArray(parsed.matchedKeywords)
    ? parsed.matchedKeywords.filter((v): v is string => typeof v === "string")
    : [];

  const title = sanitizeTextField(parsed.title, fallback?.itemTitle ?? "");
  const summary = sanitizeTextField(parsed.summary, fallback?.itemSummary ?? "");
  const category = sanitizeTextField(parsed.category, "general");
  const importanceExplanation = sanitizeTextField(
    parsed.importanceExplanation,
    "",
  );

  if (!title || !summary) {
    throw new Error(
      "Event extraction returned isRelevant=true but missing title or summary.",
    );
  }

  return {
    category,
    importanceExplanation,
    isRelevant: true,
    matchedKeywords,
    raw: parsed,
    relevanceScore,
    summary,
    title,
  };
}

export function fallbackEventExtraction(
  input: EventExtractionInput,
): EventExtractionResult {
  return {
    category: "general",
    importanceExplanation: "基于主题关键词匹配的候选事件，建议人工确认。",
    isRelevant: true,
    matchedKeywords: [],
    raw: {
      mode: "deterministic-fallback",
      reason: "AI extraction unavailable or failed, using rules-based fallback.",
    },
    relevanceScore: 65,
    summary: input.item.summary?.trim() || input.item.title,
    title: input.item.title.trim(),
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

function sanitizeTextField(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
