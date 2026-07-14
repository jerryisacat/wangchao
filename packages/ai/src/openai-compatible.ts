import type {
  AiChatRequest,
  AiChatResponse,
  OpenAiCompatibleAdapterOptions,
} from "./types.js";

interface ChatCompletionsPayload {
  max_tokens?: number;
  messages: AiChatRequest["messages"];
  model: string;
  response_format?: { type: "json_object" };
  temperature?: number;
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  model?: string;
  output_text?: string;
}

export class OpenAiCompatibleAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly jsonModeUnsupportedModels = new Set<string>();

  constructor(options: OpenAiCompatibleAdapterOptions) {
    this.apiKey = options.apiKey;

    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new Error(`Invalid baseUrl: ${options.baseUrl}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid baseUrl protocol: ${parsed.protocol}. Only http/https allowed.`);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" ||
        hostname.startsWith("169.254.") || hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") || hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
      throw new Error(`Private/internal IP addresses are not allowed in baseUrl: ${hostname}`);
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.sendChatRequest(request);
      } catch (error) {
        lastError = error;

        if (
          request.jsonMode &&
          isJsonModeError(error) &&
          !this.jsonModeUnsupportedModels.has(request.model)
        ) {
          this.jsonModeUnsupportedModels.add(request.model);
          return this.sendChatRequest({ ...request, jsonMode: false });
        }

        if (attempt === this.maxRetries || !isRetryableError(error)) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async sendChatRequest(request: AiChatRequest): Promise<AiChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload: ChatCompletionsPayload = {
        max_tokens: request.maxTokens,
        messages: request.messages,
        model: request.model,
        temperature: request.temperature,
      };

      if (request.jsonMode && !this.jsonModeUnsupportedModels.has(request.model)) {
        payload.response_format = { type: "json_object" };
      }

      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        body: JSON.stringify(payload),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }
        throw new AiHttpError(response.status, errorBody);
      }

      const raw = (await response.json()) as ChatCompletionsResponse;

      const content =
        raw.choices?.[0]?.message?.content ?? raw.output_text ?? "";

      return {
        content,
        model: raw.model,
        raw,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenAiCompatibleAdapter(
  options: OpenAiCompatibleAdapterOptions,
): OpenAiCompatibleAdapter {
  return new OpenAiCompatibleAdapter(options);
}

class AiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`AI provider request failed with HTTP ${status}`);
  }
}

function isJsonModeError(error: unknown): boolean {
  if (!(error instanceof AiHttpError)) {
    return false;
  }

  const body = JSON.stringify(error.body).toLowerCase();
  return (
    error.status === 400 &&
    (body.includes("response_format") ||
      body.includes("json mode") ||
      body.includes("json_object"))
  );
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof AiHttpError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }

  return error instanceof Error && error.name === "AbortError";
}
