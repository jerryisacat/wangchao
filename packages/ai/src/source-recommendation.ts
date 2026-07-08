import { parseJsonObject, validateJsonObject } from "./parser.js";
import type { AiChatMessage, JsonSchema } from "./types.js";

export interface SourceRecommendationInput {
  evidence?: Record<string, unknown>;
  sourceName: string;
  sourceUrl: string;
  topicDescription?: string | null;
  topicKeywords?: string[];
  topicName: string;
}

export interface SourceRecommendation {
  reason: string;
  relevanceScore: number;
  raw: Record<string, unknown>;
}

export interface SourceRecommendationAdapter {
  chat(request: {
    jsonMode?: boolean;
    maxTokens?: number;
    messages: AiChatMessage[];
    model: string;
    temperature?: number;
  }): Promise<{ content: string; raw: unknown }>;
}

const SOURCE_RECOMMENDATION_SCHEMA: JsonSchema = {
  required: ["reason", "relevanceScore"],
  properties: {
    reason: { type: "string" },
    relevanceScore: { type: "number" },
  },
};

export function buildSourceRecommendationMessages(
  input: SourceRecommendationInput,
): AiChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You evaluate whether a public source should be added to a topic-driven intelligence workspace. Return strict JSON only.",
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction:
          "Explain in one concise Chinese sentence why this source is worth observing for the topic, and score relevance from 0 to 1.",
        outputSchema: {
          reason: "string, one concise Chinese sentence",
          relevanceScore: "number, 0 to 1",
        },
        source: {
          name: input.sourceName,
          url: input.sourceUrl,
        },
        topic: {
          description: input.topicDescription,
          keywords: input.topicKeywords ?? [],
          name: input.topicName,
        },
        evidence: input.evidence ?? {},
      }),
    },
  ];
}

export async function recommendSourceCandidate(
  input: SourceRecommendationInput,
  options: {
    adapter: SourceRecommendationAdapter;
    model: string;
  },
): Promise<SourceRecommendation> {
  const response = await options.adapter.chat({
    jsonMode: true,
    maxTokens: 300,
    messages: buildSourceRecommendationMessages(input),
    model: options.model,
    temperature: 0.2,
  });

  return parseSourceRecommendationResponse(response.content);
}

export function parseSourceRecommendationResponse(
  content: string,
): SourceRecommendation {
  const parsed = parseJsonObject(content);
  const validation = validateJsonObject(parsed, SOURCE_RECOMMENDATION_SCHEMA);

  if (!validation.ok) {
    throw new Error(
      `Invalid source recommendation JSON: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const reason = sanitizeRecommendationReason(String(parsed.reason));
  const relevanceScore = clamp(Number(parsed.relevanceScore), 0, 1);

  if (!reason) {
    throw new Error("Source recommendation reason is empty.");
  }

  if (!Number.isFinite(relevanceScore)) {
    throw new Error("Source recommendation score is not finite.");
  }

  return {
    raw: parsed,
    reason,
    relevanceScore,
  };
}

export function fallbackSourceRecommendation(
  input: SourceRecommendationInput,
): SourceRecommendation {
  const reason = `${input.sourceName} 与「${input.topicName}」相关，建议先作为候选源观察其稳定性和信号质量。`;

  return {
    raw: {
      mode: "deterministic-fallback",
      reason,
      relevanceScore: 0.55,
    },
    reason,
    relevanceScore: 0.55,
  };
}

function sanitizeRecommendationReason(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
