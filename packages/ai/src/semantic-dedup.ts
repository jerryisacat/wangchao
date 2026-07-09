import { parseJsonObject, validateJsonObject } from "./parser.js";
import type { AiChatMessage, JsonSchema } from "./types.js";

export interface SemanticDedupCandidate {
  eventId: string;
  title: string;
  summary: string;
  sourceName: string | null;
  occurredAt: string | null;
}

export interface SemanticDedupInput {
  newEvent: SemanticDedupCandidate;
  candidateEvents: SemanticDedupCandidate[];
  topicName: string;
  topicDescription?: string | null;
}

export interface SemanticDedupResult {
  duplicateEventId: string | null;
  confidence: number;
  reason: string;
}

export interface SemanticDedupAdapter {
  chat(request: {
    jsonMode?: boolean;
    maxTokens?: number;
    messages: AiChatMessage[];
    model: string;
    temperature?: number;
  }): Promise<{ content: string; raw: unknown }>;
}

const SEMANTIC_DEDUP_SCHEMA: JsonSchema = {
  required: ["isDuplicate"],
  properties: {
    isDuplicate: { type: "boolean" },
    duplicateEventId: { type: "string" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
};

export function buildSemanticDedupMessages(
  input: SemanticDedupInput,
): AiChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You compare intelligence events to decide if two events describe the same real-world occurrence. Return strict JSON only.",
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction:
          "Compare the new event with each candidate event. Determine if any candidate describes the SAME real-world event. Consider: same core occurrence, same entities, same timeframe (within 24h). Different topics or different occurrences with similar keywords are NOT duplicates.",
        outputSchema: {
          isDuplicate: "boolean, true if newEvent matches any candidate",
          duplicateEventId: "string, the matching event ID, or empty string if no match",
          confidence: "number 0-1, how certain you are",
          reason: "string in Chinese, one sentence explaining your decision",
        },
        topic: {
          name: input.topicName,
          description: input.topicDescription ?? "",
        },
        newEvent: input.newEvent,
        candidateEvents: input.candidateEvents,
      }),
    },
  ];
}

export async function dedupEvent(
  input: SemanticDedupInput,
  options: {
    adapter: SemanticDedupAdapter;
    maxTokens?: number;
    model: string;
    temperature?: number;
  },
): Promise<SemanticDedupResult> {
  const response = await options.adapter.chat({
    jsonMode: true,
    maxTokens: options.maxTokens ?? 400,
    messages: buildSemanticDedupMessages(input),
    model: options.model,
    temperature: options.temperature ?? 0.1,
  });

  return parseSemanticDedupResponse(response.content);
}

export function parseSemanticDedupResponse(
  content: string,
): SemanticDedupResult {
  const parsed = parseJsonObject(content);
  const validation = validateJsonObject(parsed, SEMANTIC_DEDUP_SCHEMA);

  if (!validation.ok) {
    throw new Error(
      `Invalid semantic dedup JSON: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const isDuplicate = Boolean(parsed.isDuplicate);
  const duplicateEventId =
    typeof parsed.duplicateEventId === "string" && parsed.duplicateEventId
      ? parsed.duplicateEventId
      : "";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
  const reason =
    typeof parsed.reason === "string"
      ? parsed.reason.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

  return {
    duplicateEventId: isDuplicate ? duplicateEventId : null,
    confidence,
    reason,
  };
}
