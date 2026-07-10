import { extractJsonCandidate, parseJsonObject, sanitizeModelText, validateJsonObject } from "./parser.js";

export function runParserFixtures(): void {
  const sanitized = sanitizeModelText("thinkhidden\n```json\n{reason:\"ok\",}\n```");
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

  fixtureNestedObject();
  fixtureRootArrayRejected();
  fixtureMarkdownFence();
  fixtureTruncatedJson();
  fixtureEmbeddedExplanationText();
  fixtureThinkTagsWithFence();
  fixtureTrailingComma();
  fixtureUnquotedKey();
}

function fixtureNestedObject(): void {
  const result = parseJsonObject('{"outer":{"inner":{"deep":"value"}}}');
  const outer = result.outer as Record<string, unknown>;
  const inner = outer.inner as Record<string, unknown>;
  assert(
    inner.deep === "value",
    "Parser should handle nested objects.",
  );
}

function fixtureRootArrayRejected(): void {
  assertThrows(
    () => parseJsonObject("[1,2,3]"),
    "Root array should be rejected (no braces found).",
  );
}

function fixtureMarkdownFence(): void {
  const result = parseJsonObject('```json\n{"key":"value"}\n```');
  assert(result.key === "value", "Parser should strip markdown fence.");
}

function fixtureTruncatedJson(): void {
  assertThrows(
    () => parseJsonObject('{"key":"val'),
    "Truncated JSON should throw.",
  );
}

function fixtureEmbeddedExplanationText(): void {
  const result = parseJsonObject('Here is the result:\n{"reason":"ok"}\nThat is all.');
  assert(result.reason === "ok", "Parser should extract JSON from surrounding text.");
}

function fixtureThinkTagsWithFence(): void {
  const cleaned = sanitizeModelText('<reasoning>hidden</reasoning>\n```json\n{"x":1}\n```');
  assert(
    !cleaned.includes("reasoning"),
    "sanitizeModelText should remove reasoning tags.",
  );
  assert(
    !cleaned.includes("```"),
    "sanitizeModelText should remove markdown fences.",
  );
  const result = parseJsonObject(cleaned);
  assert(result.x === 1, "Parser should parse after think tags + fence.");
}

function fixtureTrailingComma(): void {
  const result = parseJsonObject('{"a":1,}');
  assert(result.a === 1, "Parser should repair trailing comma.");
}

function fixtureUnquotedKey(): void {
  const result = parseJsonObject('{key:"value"}');
  assert(result.key === "value", "Parser should repair unquoted key.");
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
