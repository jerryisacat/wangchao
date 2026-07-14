import type { PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface MarkWebhookEventInput extends TenantScope {
  provider: string;
  recordId: string;
}

export async function isWebhookRecordProcessed(
  prisma: PrismaClient,
  provider: string,
  recordId: string,
): Promise<boolean> {
  const existing = await prisma.webhookEvent.findUnique({
    where: {
      provider_recordId: { provider, recordId },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function markWebhookEventProcessed(
  prisma: PrismaClient,
  input: MarkWebhookEventInput,
): Promise<void> {
  await prisma.webhookEvent.create({
    data: {
      provider: input.provider,
      recordId: input.recordId,
      organizationId: input.organizationId,
    },
  });
}

export async function claimWebhookEvent(
  prisma: PrismaClient,
  input: MarkWebhookEventInput,
): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: input.provider,
        recordId: input.recordId,
        organizationId: input.organizationId,
      },
    });
    return true;
  } catch {
    return false;
  }
}
