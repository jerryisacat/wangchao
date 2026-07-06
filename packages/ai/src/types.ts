export type AiProviderName = "openai-compatible";

export interface AiAdapterDescriptor {
  provider: AiProviderName;
  supportsJsonModeFallback: boolean;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AiChatResponse {
  content: string;
  model?: string;
  raw: unknown;
}

export interface OpenAiCompatibleAdapterOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface JsonSchema {
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
}

export interface JsonSchemaProperty {
  type: "array" | "boolean" | "number" | "object" | "string";
}

export const defaultAiAdapter: AiAdapterDescriptor = {
  provider: "openai-compatible",
  supportsJsonModeFallback: true,
};
