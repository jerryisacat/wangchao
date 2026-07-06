import type { JsonSchema } from "./types.js";

export interface JsonValidationIssue {
  path: string;
  message: string;
}

export interface JsonValidationResult {
  issues: JsonValidationIssue[];
  ok: boolean;
}

export function sanitizeModelText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .trim();
}

export function extractJsonCandidate(text: string): string {
  const sanitized = sanitizeModelText(text);
  const start = sanitized.indexOf("{");
  const end = sanitized.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response.");
  }

  return sanitized.slice(start, end + 1);
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const candidate = repairCommonJsonIssues(extractJsonCandidate(text));
  const parsed = JSON.parse(candidate) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response JSON is not an object.");
  }

  return parsed as Record<string, unknown>;
}

export function validateJsonObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
): JsonValidationResult {
  const issues: JsonValidationIssue[] = [];

  for (const field of schema.required ?? []) {
    if (!(field in value)) {
      issues.push({
        path: field,
        message: "Required field is missing.",
      });
    }
  }

  for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
    if (!(field in value)) {
      continue;
    }

    const actualType = Array.isArray(value[field]) ? "array" : typeof value[field];
    if (actualType !== fieldSchema.type) {
      issues.push({
        path: field,
        message: `Expected ${fieldSchema.type}, received ${actualType}.`,
      });
    }
  }

  return {
    issues,
    ok: issues.length === 0,
  };
}

function repairCommonJsonIssues(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*undefined(\s*[,}])/g, ": null$1");
}
