import type { Prisma } from "@prisma/client";
import type { DashboardEventAction, SourceGovernanceAction } from "./types.js";

export function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

export function readRuntimeEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };

  return runtime.process?.env?.[key];
}

export function readRequiredRuntimeEnv(key: string): string {
  const value = readRuntimeEnv(key);
  if (!value) {
    throw new Error(`${key} is required but not set.`);
  }
  return value;
}

export function toInputJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

export function toRequiredInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function actionToEventState(action: DashboardEventAction): {
  feedbackKind: "READ" | "SAVE" | "DISMISS";
  status: "READ" | "SAVED" | "DISMISSED";
  value: number;
} {
  if (action === "read") {
    return { feedbackKind: "READ", status: "READ", value: 1 };
  }

  if (action === "save") {
    return { feedbackKind: "SAVE", status: "SAVED", value: 2 };
  }

  return { feedbackKind: "DISMISS", status: "DISMISSED", value: -2 };
}

export function sourceActionToStatus(
  action: SourceGovernanceAction,
): "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED" {
  if (action === "approve") {
    return "ACTIVE";
  }

  if (action === "mute") {
    return "MUTED";
  }

  if (action === "reject") {
    return "REJECTED";
  }

  return "CANDIDATE";
}

export function calculateSourceQualityScore(input: {
  duplicateRate: number;
  hitRate: number;
  noiseRate: number;
  trustScore: number;
}): number {
  const score =
    input.hitRate * 70 +
    input.trustScore * 10 -
    input.noiseRate * 30 -
    input.duplicateRate * 15;

  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

export function recommendSourceStatus(
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED",
  qualityScore: number,
  totalItems: number,
  noiseRate: number,
): "APPROVE" | "OBSERVE" | "MUTE" | "REJECT" {
  if (status === "REJECTED") {
    return "REJECT";
  }

  if (totalItems === 0) {
    return status === "CANDIDATE" ? "OBSERVE" : "APPROVE";
  }

  if (qualityScore >= 50 && noiseRate < 0.4) {
    return "APPROVE";
  }

  if (noiseRate >= 0.75) {
    return "REJECT";
  }

  if (noiseRate >= 0.55 || qualityScore < 15) {
    return "MUTE";
  }

  return "OBSERVE";
}

export function ratio(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Number((value / total).toFixed(4));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readObservationReason(value: unknown): string | null {
  if (!isRecord(value) || typeof value.reason !== "string") {
    return null;
  }

  return value.reason;
}

export function extractPreferenceWeight(value: unknown): number {
  if (!isRecord(value) || typeof value.weight !== "number") {
    return 0;
  }

  return value.weight;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
