import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface InstantPushSettingsView {
  enabled: boolean;
  enabledAt: Date | null;
  hasTelegramCredential: boolean;
  plan: "FREE" | "PLUS" | "PRO";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  isSelfHosted: boolean;
  currentPeriodEnd: string | null;
}

export async function getInstantPushSettings(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<InstantPushSettingsView> {
  const [subscription, telegramCred] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId: scope.organizationId },
      select: {
        instantPushEnabled: true,
        instantPushEnabledAt: true,
        plan: true,
        status: true,
        isSelfHosted: true,
        currentPeriodEnd: true,
      },
    }),
    prisma.organizationCredential.findUnique({
      where: {
        organizationId_credentialType: {
          organizationId: scope.organizationId,
          credentialType: "TELEGRAM",
        },
      },
      select: {
        encryptedKey: true,
        chatId: true,
      },
    }),
  ]);

  return {
    enabled: subscription?.instantPushEnabled ?? false,
    enabledAt: subscription?.instantPushEnabledAt ?? null,
    hasTelegramCredential: Boolean(telegramCred?.encryptedKey && telegramCred.chatId),
    plan: subscription?.plan ?? "FREE",
    status: subscription?.status ?? "ACTIVE",
    isSelfHosted: subscription?.isSelfHosted ?? false,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
  };
}

export async function setInstantPushEnabled(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<void> {
  const now = new Date();
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: { instantPushEnabledAt: true },
  });
  const enabledAt = enabled ? existing?.instantPushEnabledAt ?? now : null;
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      instantPushEnabled: enabled,
      instantPushEnabledAt: enabledAt,
    },
    create: {
      organizationId: scope.organizationId,
      instantPushEnabled: enabled,
      instantPushEnabledAt: enabledAt,
    },
  });
}

export interface InstantPushOrganizationRecord {
  organizationId: string;
  userId: string | null;
}

export async function listInstantPushOrganizations(
  prisma: PrismaClient,
): Promise<InstantPushOrganizationRecord[]> {
  const rows = await prisma.subscription.findMany({
    where: { instantPushEnabled: true },
    select: {
      organizationId: true,
      organization: {
        select: { memberships: { select: { userId: true }, take: 1, orderBy: { createdAt: "asc" } } },
      },
    },
  });
  return rows.map((row) => ({
    organizationId: row.organizationId,
    userId: row.organization.memberships[0]?.userId ?? null,
  }));
}

export interface InstantPushCandidateRecord {
  eventId: string;
  organizationId: string;
  title: string;
  summary: string;
  score: number;
  topicName: string;
  sourceName: string | null;
  sourceUrl: string | null;
}

export async function listInstantPushCandidates(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { enabledAt: Date; scoreThreshold: number; limit: number },
): Promise<InstantPushCandidateRecord[]> {
  const rows = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      score: { gte: input.scoreThreshold },
      createdAt: { gte: input.enabledAt },
      instantPushLogs: { none: { status: { in: ["SENT", "SKIPPED"] } } },
      OR: [
        { primaryItem: { source: { status: "ACTIVE" } } },
        { eventItems: { some: { item: { source: { status: "ACTIVE" } } } } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      summary: true,
      score: true,
      topic: { select: { name: true } },
      primaryItem: { select: { url: true, source: { select: { name: true, status: true } } } },
      eventItems: {
        where: { item: { source: { status: "ACTIVE" } } },
        take: 1,
        select: { item: { select: { url: true, source: { select: { name: true } } } } },
      },
    },
    orderBy: [{ createdAt: "asc" }, { score: "desc" }],
    take: input.limit,
  });
  return rows.map((row) => {
    const primary = row.primaryItem?.source.status === "ACTIVE" ? row.primaryItem : null;
    const fallback = row.eventItems[0]?.item ?? null;
    return {
      eventId: row.id,
      organizationId: row.organizationId,
      title: row.title,
      summary: row.summary,
      score: row.score,
      topicName: row.topic.name,
      sourceName: primary?.source.name ?? fallback?.source.name ?? null,
      sourceUrl: primary?.url ?? fallback?.url ?? null,
    };
  });
}

export interface InstantPushLogRecord {
  id: string;
  attempt: number;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
}

export async function claimInstantPush(
  prisma: PrismaClient,
  input: {
    eventId: string;
    organizationId: string;
    score: number;
    recipientRef: string;
    maxAttempts: number;
    staleBefore: Date;
    now?: Date;
  },
): Promise<InstantPushLogRecord | null> {
  const now = input.now ?? new Date();
  const existing = await prisma.instantPushLog.findUnique({
    where: { eventId_channel: { eventId: input.eventId, channel: "TELEGRAM" } },
  });
  if (!existing) {
    try {
      return await prisma.instantPushLog.create({
        data: {
          organizationId: input.organizationId,
          eventId: input.eventId,
          channel: "TELEGRAM",
          status: "SENDING",
          score: input.score,
          attempt: 1,
          recipientRef: input.recipientRef,
          lockedAt: now,
        },
        select: { id: true, attempt: true, status: true },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }
  if (existing.attempt >= input.maxAttempts || existing.status === "SENT" || existing.status === "SKIPPED") return null;
  const retryable =
    existing.status === "PENDING" ||
    (existing.status === "FAILED" && (!existing.nextAttemptAt || existing.nextAttemptAt <= now)) ||
    (existing.status === "SENDING" && Boolean(existing.lockedAt && existing.lockedAt <= input.staleBefore));
  if (!retryable) return null;
  const updated = await prisma.instantPushLog.updateMany({
    where: { id: existing.id, status: existing.status, attempt: existing.attempt },
    data: { status: "SENDING", attempt: { increment: 1 }, lockedAt: now, nextAttemptAt: null, errorMessage: null, errorCode: null },
  });
  if (updated.count !== 1) return null;
  return prisma.instantPushLog.findUnique({
    where: { id: existing.id },
    select: { id: true, attempt: true, status: true },
  });
}

export async function markInstantPushSent(prisma: PrismaClient, logId: string): Promise<void> {
  await prisma.instantPushLog.update({ where: { id: logId }, data: { status: "SENT", sentAt: new Date(), lockedAt: null, nextAttemptAt: null } });
}

export async function markInstantPushFailed(
  prisma: PrismaClient,
  logId: string,
  input: { attempt: number; errorMessage: string; errorCode?: string | null; retryAfterMs?: number; retryable: boolean },
): Promise<void> {
  const retryDelay = input.retryAfterMs ?? Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, input.attempt - 1));
  await prisma.instantPushLog.update({
    where: { id: logId },
    data: {
      status: input.retryable ? "FAILED" : "SKIPPED",
      errorMessage: input.errorMessage.slice(0, 1000),
      errorCode: input.errorCode ?? null,
      nextAttemptAt: input.retryable ? new Date(Date.now() + retryDelay) : null,
      lockedAt: null,
    },
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
