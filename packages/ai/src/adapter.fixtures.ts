import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import type { AiChatRequest } from "./types.js";

export async function runAdapterFixtures(): Promise<void> {
  await fixtureStandardChatResponse();
  await fixtureOutputTextFallback();
  await fixtureEmptyChoicesArray();
  await fixtureMultiChoiceResponse();
  await fixture4xxNonRetryableError();
  await fixture5xxRetryThenSuccess();
  await fixture429RetryThenSuccess();
  await fixtureMaxRetriesExhausted();
  await fixtureNonJsonErrorBody();
  await fixtureAbortErrorRetryThenFail();
  await fixtureJsonModeFallback();
  await fixtureJsonModeRemembered();
}

function makeOkResponse(content: string, model = "gpt-4o"): ResponseLike {
  return makeResponse(200, {
    choices: [{ message: { content } }],
    model,
  });
}

function makeResponse(status: number, body: unknown, headers?: Record<string, string>): ResponseLike {
  return {
    headers: headers ?? {},
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === "string") {
        throw new SyntaxError("Unexpected token in JSON");
      }
      return body;
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function makeRequest(jsonMode = false): AiChatRequest {
  return {
    jsonMode,
    maxTokens: 100,
    messages: [{ role: "user", content: "hello" }],
    model: "gpt-4o",
    temperature: 0.2,
  };
}

function makeAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

async function fixtureStandardChatResponse(): Promise<void> {
  const fetchImpl = asyncMock(makeOkResponse("hello"));
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(result.content === "hello", "Standard chat should return content.");
  assert(result.model === "gpt-4o", "Standard chat should return model.");
}

async function fixtureOutputTextFallback(): Promise<void> {
  const fetchImpl = asyncMock(
    makeResponse(200, { output_text: "fallback content" }),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(result.content === "fallback content", "Should fall back to output_text.");
}

async function fixtureEmptyChoicesArray(): Promise<void> {
  const fetchImpl = asyncMock(makeResponse(200, { choices: [] }));
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(result.content === "", "Empty choices should fall back to empty string.");
}

async function fixtureMultiChoiceResponse(): Promise<void> {
  const fetchImpl = asyncMock(
    makeResponse(200, {
      choices: [
        { message: { content: "first" } },
        { message: { content: "second" } },
      ],
      model: "gpt-4o",
    }),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(
    result.content === "first",
    "Multi-choice response: adapter reads choices[0] (expected current behavior).",
  );
}

async function fixture4xxNonRetryableError(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(400, { error: { message: "bad request" } }),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  let caught: unknown;
  try {
    await adapter.chat(makeRequest());
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof Error, "4xx should throw an Error.");
  assert(
    (caught as { status?: number }).status === 400,
    "4xx error should carry status 400.",
  );
  assert(calls.count === 1, "4xx should not be retried (single call).");
}

async function fixture5xxRetryThenSuccess(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(503, { error: "unavailable" }),
    makeOkResponse("recovered"),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(result.content === "recovered", "5xx should retry and succeed.");
  assert(calls.count === 2, "5xx should trigger exactly 2 fetch calls.");
}

async function fixture429RetryThenSuccess(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(429, { error: "rate limited" }, { "retry-after": "1" }),
    makeOkResponse("ok"),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest());

  assert(result.content === "ok", "429 should retry and succeed.");
  assert(calls.count === 2, "429 should trigger exactly 2 fetch calls.");
}

async function fixtureMaxRetriesExhausted(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(503, { error: "unavailable" }),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
    maxRetries: 1,
  });

  let caught: unknown;
  try {
    await adapter.chat(makeRequest());
  } catch (error) {
    caught = error;
  }

  assert(
    (caught as { status?: number }).status === 503,
    "Exhausted retries should throw last error with status 503.",
  );
  assert(
    calls.count === 2,
    "maxRetries=1 should result in initial + 1 retry = 2 calls.",
  );
}

async function fixtureNonJsonErrorBody(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(500, "Internal Server Error"),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
    maxRetries: 0,
  });

  let caught: unknown;
  try {
    await adapter.chat(makeRequest());
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof Error, "Non-JSON error body should throw an Error.");
  assert(
    (caught as { status?: number }).status === 500,
    "Non-JSON error body should still carry status 500.",
  );
  assert(
    typeof (caught as { body?: unknown }).body === "string",
    "Non-JSON error body should be stored as text.",
  );
}

async function fixtureAbortErrorRetryThenFail(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(calls, makeAbortError());
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
    maxRetries: 1,
  });

  let caught: unknown;
  try {
    await adapter.chat(makeRequest());
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof Error, "AbortError should propagate as Error.");
  assert(
    (caught as Error).name === "AbortError",
    "Propagated error should retain AbortError name.",
  );
  assert(
    calls.count === 2,
    "AbortError should be retried (initial + 1 retry = 2 calls).",
  );
}

async function fixtureJsonModeFallback(): Promise<void> {
  const calls = trackCalls();
  const fetchImpl = asyncMockFn(
    calls,
    makeResponse(400, {
      error: { message: "response_format is not supported" },
    }),
    makeOkResponse("fallback-ok"),
  );
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  const result = await adapter.chat(makeRequest(true));

  assert(result.content === "fallback-ok", "JSON mode fallback should succeed.");

  const firstBody = JSON.parse(calls.bodies[0] as string) as {
    response_format?: unknown;
  };
  assert(
    firstBody.response_format !== undefined,
    "First JSON mode request should include response_format.",
  );

  const secondBody = JSON.parse(calls.bodies[1] as string) as {
    response_format?: unknown;
  };
  assert(
    secondBody.response_format === undefined,
    "Fallback request should omit response_format.",
  );
}

async function fixtureJsonModeRemembered(): Promise<void> {
  const calls = trackCalls();
  const jsonModeError = makeResponse(400, {
    error: { message: "response_format is not supported" },
  });
  const okResponse = makeOkResponse("ok");
  const fetchImpl = asyncMockFn(calls, jsonModeError, okResponse);
  const adapter = new OpenAiCompatibleAdapter({
    apiKey: "key",
    baseUrl: "https://api.example.com",
    fetchImpl,
  });

  await adapter.chat(makeRequest(true));

  calls.reset();
  const result = await adapter.chat(makeRequest(true));

  assert(result.content === "ok", "Second jsonMode request should succeed.");
  assert(
    calls.count === 1,
    "Remembered jsonMode-unsupported model should skip JSON mode on retry (1 fetch call).",
  );

  const body = JSON.parse(calls.bodies[0] as string) as {
    response_format?: unknown;
  };
  assert(
    body.response_format === undefined,
    "Remembered model request should omit response_format.",
  );
}

interface ResponseLike {
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

interface CallTracker {
  bodies: (string | undefined)[];
  count: number;
  reset(): void;
}

function trackCalls(): CallTracker {
  const tracker: CallTracker = {
    bodies: [],
    count: 0,
    reset() {
      tracker.bodies = [];
      tracker.count = 0;
    },
  };
  return tracker;
}

function asyncMock(response: ResponseLike): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

function asyncMockFn(
  tracker: CallTracker,
  ...responses: ResponseLike[] | Error[]
): typeof fetch {
  let index = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    tracker.bodies.push(init?.body?.toString());
    tracker.count += 1;
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as unknown as typeof fetch;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
