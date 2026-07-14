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
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, "")
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
    .replace(/<internal>[\s\S]*?<\/internal>/gi, "")
    .replace(/<draft>[\s\S]*?<\/draft>/gi, "")
    .replace(/<processed>[\s\S]*?<\/processed>/gi, "")
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .trim();
}

export function extractJsonCandidate(text: string): string {
  const sanitized = sanitizeModelText(text);

  const start = sanitized.indexOf("{");
  const end = sanitized.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return sanitized.slice(start, end + 1);
  }

  const arrStart = sanitized.indexOf("[");
  const arrEnd = sanitized.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    return sanitized.slice(arrStart, arrEnd + 1);
  }

  throw new Error("No JSON object or array found in model response.");
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
  strict = true,
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

  if (strict && schema.properties) {
    for (const field of Object.keys(value)) {
      if (!(field in schema.properties)) {
        issues.push({
          path: field,
          message: "Unexpected field not in schema.",
        });
      }
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
