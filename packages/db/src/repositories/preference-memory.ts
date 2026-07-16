import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface PreferenceMemoryUpdate {
  key: string;
  topicId: string;
  weight: number;
  confidence: number;
  explanation: string;
}

export async function deletePreferenceMemory(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { key: string; topicId: string },
): Promise<void> {
  await prisma.preferenceMemory.deleteMany({
    where: {
      organizationId: scope.organizationId,
      topicId: input.topicId,
      key: input.key,
    },
  });
}

export async function updatePreferenceMemoryWeight(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { key: string; topicId: string; weight: number },
): Promise<void> {
  const clamped = Math.max(-4, Math.min(4, input.weight));
  const existing = await prisma.preferenceMemory.findFirst({
    where: {
      organizationId: scope.organizationId,
      topicId: input.topicId,
      key: input.key,
    },
  });

  if (!existing) {
    return;
  }

  const newSignalCount = Math.max(1, Math.round(Math.abs(clamped)));
  const explanation = buildPreferenceUpdateExplanation(input.key, clamped, newSignalCount);

  await prisma.preferenceMemory.update({
    where: { id: existing.id },
    data: {
      value: { signalCount: newSignalCount, weight: clamped } as Prisma.InputJsonValue,
      explanation,
      confidence: Math.min(0.95, 0.35 + newSignalCount * 0.12),
    },
  });
}

export async function recordEnhancedFeedback(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    topicId: string;
    userId: string;
    kind:
      | "MORE_LIKE_THIS"
      | "LESS_LIKE_THIS"
      | "SOURCE_QUALITY_UP"
      | "SOURCE_QUALITY_DOWN"
      | "SCORE_UP"
      | "SCORE_DOWN";
    eventId?: string;
    itemId?: string;
    sourceId?: string;
    value?: number;
    reason?: string;
  },
): Promise<void> {
  await prisma.feedbackEvent.create({
    data: {
      organizationId: scope.organizationId,
      topicId: input.topicId,
      userId: input.userId,
      kind: input.kind,
      eventId: input.eventId ?? null,
      itemId: input.itemId ?? null,
      sourceId: input.sourceId ?? null,
      value: input.value ?? null,
      reason: input.reason ?? null,
    },
  });
}

function buildPreferenceUpdateExplanation(
  key: string,
  weight: number,
  signalCount: number,
): string {
  const direction = weight >= 0 ? "increased" : "decreased";
  const target = key.startsWith("source") ? "source" : "category";
  return `${signalCount} feedback signals ${direction} the ${target} preference for ${key}.`;
}
