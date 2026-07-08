import { parseJsonObject, sanitizeModelText, validateJsonObject } from "./parser.js";

export function runParserFixtures(): void {
  const sanitized = sanitizeModelText("<think>hidden</think>```json\n{reason:\"ok\",}\n```");
  const parsed = parseJsonObject(sanitized);
  const validation = validateJsonObject(parsed, {
    required: ["reason"],
    properties: {
      reason: { type: "string" },
    },
  });

  assert(parsed.reason === "ok", "Parser should repair common JSON issues.");
  assert(validation.ok, "Parser fixture schema should validate.");
  assertThrows(() => parseJsonObject("no json here"), "Parser should reject empty JSON.");
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
