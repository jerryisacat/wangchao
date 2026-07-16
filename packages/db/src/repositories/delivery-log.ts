import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface DeliveryLogRecord {
  id: string;
  briefingId: string;
  channel: "TELEGRAM";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  sentAt: Date | null;
}

export async function findPendingDeliveryForBriefing(
  prisma: PrismaClient,
  briefingId: string,
  channel: "TELEGRAM",
): Promise<DeliveryLogRecord | null> {
  const log = await prisma.deliveryLog.findUnique({
    where: { briefingId_channel: { briefingId, channel } },
  });

  if (!log) {
    return null;
  }

  return toDeliveryLogRecord(log);
}

export async function createDeliveryLog(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    briefingId: string;
    channel: "TELEGRAM";
    status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
    recipientRef?: string | null;
    errorMessage?: string | null;
    errorCode?: string | null;
    metadata?: unknown;
  },
): Promise<DeliveryLogRecord> {
  const log = await prisma.deliveryLog.create({
    data: {
      organizationId: input.organizationId,
      briefingId: input.briefingId,
      channel: input.channel,
      status: input.status,
      attempt: input.status === "PENDING" ? 0 : 1,
      recipientRef: input.recipientRef ?? null,
      errorMessage: input.errorMessage ?? null,
      errorCode: input.errorCode ?? null,
      sentAt: input.status === "SENT" ? new Date() : null,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  return toDeliveryLogRecord(log);
}

export async function updateDeliveryLog(
  prisma: PrismaClient,
  deliveryLogId: string,
  input: {
    status: "SENT" | "FAILED" | "SKIPPED";
    attempt?: number;
    errorMessage?: string | null;
    errorCode?: string | null;
    metadata?: unknown;
  },
): Promise<void> {
  await prisma.deliveryLog.update({
    where: { id: deliveryLogId },
    data: {
      status: input.status,
      attempt: input.attempt,
      errorMessage: input.errorMessage,
      errorCode: input.errorCode,
      sentAt: input.status === "SENT" ? new Date() : undefined,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function findBriefingsForTelegramDelivery(
  prisma: PrismaClient,
  scope: TenantScope,
  since: Date,
): Promise<
  Array<{
    briefingId: string;
    briefingTitle: string;
    markdown: string | null;
    topicName: string;
    period: string;
  }>
> {
  const briefings = await prisma.briefing.findMany({
    where: {
      organizationId: scope.organizationId,
      generatedAt: { gte: since },
      deliveryLogs: { none: { channel: "TELEGRAM" } },
    },
    select: {
      id: true,
      title: true,
      markdown: true,
      period: true,
      topic: { select: { name: true } },
    },
    orderBy: { generatedAt: "asc" },
    take: 50,
  });

  return briefings.map((b) => ({
    briefingId: b.id,
    briefingTitle: b.title,
    markdown: b.markdown,
    topicName: b.topic.name,
    period: b.period,
  }));
}

function toDeliveryLogRecord(row: {
  id: string;
  briefingId: string;
  channel: "TELEGRAM";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  sentAt: Date | null;
}): DeliveryLogRecord {
  return {
    id: row.id,
    briefingId: row.briefingId,
    channel: row.channel,
    status: row.status,
    attempt: row.attempt,
    errorMessage: row.errorMessage,
    errorCode: row.errorCode,
    sentAt: row.sentAt,
  };
}
