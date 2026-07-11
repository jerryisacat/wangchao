import type { PrismaClient } from "@prisma/client";
import {
  decryptCredential,
  encryptCredential,
  maskKeyHint,
} from "./crypto.js";
import type { TenantScope } from "./repositories.js";

const FALLBACK_TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramCredentialView {
  hasBotToken: boolean;
  botTokenHint: string | null;
  chatId: string | null;
  enabled: boolean;
}

export interface DecryptedTelegramCredential {
  botToken: string;
  chatId: string;
}

export async function getTelegramCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<TelegramCredentialView> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      telegramEncryptedBotToken: true,
      telegramBotTokenHint: true,
      telegramChatId: true,
      telegramEnabled: true,
    },
  });

  if (!subscription) {
    return { hasBotToken: false, botTokenHint: null, chatId: null, enabled: false };
  }

  return {
    hasBotToken: Boolean(subscription.telegramEncryptedBotToken),
    botTokenHint: subscription.telegramBotTokenHint,
    chatId: subscription.telegramChatId,
    enabled: subscription.telegramEnabled,
  };
}

export async function upsertTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { botToken: string; chatId: string; enabled?: boolean },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedToken = encryptCredential(input.botToken, encryptionKey);
  const tokenHint = maskKeyHint(input.botToken);

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      telegramEncryptedBotToken: encryptedToken,
      telegramBotTokenHint: tokenHint,
      telegramChatId: input.chatId,
      telegramEnabled: input.enabled ?? true,
    },
    create: {
      organizationId: scope.organizationId,
      telegramEncryptedBotToken: encryptedToken,
      telegramBotTokenHint: tokenHint,
      telegramChatId: input.chatId,
      telegramEnabled: input.enabled ?? true,
    },
  });
}

export async function setTelegramEnabled(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: { telegramEnabled: enabled },
    create: { organizationId: scope.organizationId, telegramEnabled: enabled },
  });
}

export async function deleteTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      telegramEncryptedBotToken: null,
      telegramBotTokenHint: null,
      telegramChatId: null,
      telegramEnabled: false,
    },
    create: { organizationId: scope.organizationId },
  });
}

export async function getDecryptedTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedTelegramCredential | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      telegramEncryptedBotToken: true,
      telegramChatId: true,
      telegramEnabled: true,
    },
  });

  if (!subscription || !subscription.telegramEnabled) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!subscription.telegramEncryptedBotToken || !subscription.telegramChatId) {
    return null;
  }
  if (!encryptionKey) {
    return null;
  }

  try {
    const botToken = decryptCredential(
      subscription.telegramEncryptedBotToken,
      encryptionKey,
    );
    return { botToken, chatId: subscription.telegramChatId };
  } catch {
    return null;
  }
}

export async function testTelegramCredential(input: {
  botToken: string;
  chatId: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = process.env.TELEGRAM_API_BASE ?? FALLBACK_TELEGRAM_API_BASE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${base}/bot${input.botToken}/getMe`, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `Bot Token 验证失败：HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const body = (await response.json()) as { ok?: boolean; description?: string };
    if (!body.ok) {
      return {
        ok: false,
        message: body.description ?? "Bot Token 无效。",
      };
    }

    const chatCheck = await fetch(
      `${base}/bot${input.botToken}/getChat?chat_id=${encodeURIComponent(input.chatId)}`,
      { method: "GET", signal: controller.signal },
    );

    if (chatCheck.ok) {
      return { ok: true, message: "Telegram Bot Token 和 Chat ID 验证成功。" };
    }

    const chatBody = (await chatCheck.json().catch(() => null)) as {
      description?: string;
    } | null;
    return {
      ok: false,
      message: `Bot Token 有效，但 Chat ID 验证失败：${chatBody?.description ?? `HTTP ${chatCheck.status}`}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "Telegram API 连接超时，请检查网络。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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
      metadata: input.metadata as never,
      idempotencyKey: `${input.briefingId}:${input.channel}`,
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
      metadata: input.metadata as never,
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

export interface ReportRecord {
  id: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  markdown: string | null;
  summary: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  eventCount: number;
  itemCount: number;
  topicIds: string[];
  sourceIds: string[];
  coverageNote: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export async function createReport(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { question: string },
): Promise<ReportRecord> {
  const report = await prisma.report.create({
    data: {
      organizationId: scope.organizationId,
      question: input.question,
      status: "PENDING",
    },
  });

  return toReportRecord(report);
}

export async function getReport(
  prisma: PrismaClient,
  scope: TenantScope,
  reportId: string,
): Promise<ReportRecord | null> {
  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      organizationId: scope.organizationId,
    },
  });

  return report ? toReportRecord(report) : null;
}

export async function listReports(
  prisma: PrismaClient,
  scope: TenantScope,
  page: number,
  pageSize: number,
): Promise<{ reports: ReportRecord[]; total: number; page: number; pageCount: number }> {
  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.report.count({
      where: { organizationId: scope.organizationId },
    }),
  ]);

  return {
    reports: reports.map(toReportRecord),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateReportStatus(
  prisma: PrismaClient,
  reportId: string,
  status: "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA",
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status },
  });
}

export async function completeReport(
  prisma: PrismaClient,
  reportId: string,
  input: {
    markdown: string;
    summary: string;
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    eventCount: number;
    itemCount: number;
    topicIds: string[];
    sourceIds: string[];
    coverageNote: string;
    metadata?: unknown;
  },
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: "COMPLETED",
      markdown: input.markdown,
      summary: input.summary,
      rangeStart: input.rangeStart ?? null,
      rangeEnd: input.rangeEnd ?? null,
      eventCount: input.eventCount,
      itemCount: input.itemCount,
      topicIds: input.topicIds,
      sourceIds: input.sourceIds,
      coverageNote: input.coverageNote,
      generatedAt: new Date(),
      metadata: input.metadata as never,
    },
  });
}

export async function failReport(
  prisma: PrismaClient,
  reportId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status: "FAILED", errorMessage },
  });
}

export interface ReportEvidenceEvent {
  eventId: string;
  title: string;
  summary: string;
  category: string | null;
  score: number;
  gravityScore: number;
  entities: string[];
  occurredAt: Date | null;
  topicId: string;
  topicName: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  primaryItemUrl: string | null;
}

export async function searchReportEvidenceEvents(
  prisma: PrismaClient,
  scope: TenantScope,
  query: {
    keywords: string[];
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    limit?: number;
  },
): Promise<ReportEvidenceEvent[]> {
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      status: { in: ["UNREAD", "READ", "SAVED"] },
      ...(query.rangeStart || query.rangeEnd
        ? {
            occurredAt: {
              ...(query.rangeStart ? { gte: query.rangeStart } : {}),
              ...(query.rangeEnd ? { lte: query.rangeEnd } : {}),
            },
          }
        : {}),
      ...(query.keywords.length > 0
        ? {
            OR: query.keywords.flatMap((kw) => [
              { title: { contains: kw, mode: "insensitive" as const } },
              { summary: { contains: kw, mode: "insensitive" as const } },
            ]),
          }
        : {}),
    },
    include: {
      topic: { select: { name: true } },
      primaryItem: {
        select: {
          id: true,
          url: true,
          source: { select: { id: true, name: true, url: true } },
        },
      },
    },
    orderBy: [{ gravityScore: "desc" }, { occurredAt: "desc" }],
    take: query.limit ?? 30,
  });

  return events.map((event) => ({
    eventId: event.id,
    title: event.title,
    summary: event.summary,
    category: event.category,
    score: event.score,
    gravityScore: event.gravityScore,
    entities: event.entities,
    occurredAt: event.occurredAt,
    topicId: event.topicId,
    topicName: event.topic.name,
    sourceId: event.primaryItem?.source.id ?? null,
    sourceName: event.primaryItem?.source.name ?? null,
    sourceUrl: event.primaryItem?.source.url ?? null,
    primaryItemUrl: event.primaryItem?.url ?? null,
  }));
}

function toReportRecord(row: {
  id: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  markdown: string | null;
  summary: string | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  eventCount: number;
  itemCount: number;
  topicIds: string[];
  sourceIds: string[];
  coverageNote: string | null;
  generatedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}): ReportRecord {
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    markdown: row.markdown,
    summary: row.summary,
    rangeStart: row.rangeStart?.toISOString() ?? null,
    rangeEnd: row.rangeEnd?.toISOString() ?? null,
    eventCount: row.eventCount,
    itemCount: row.itemCount,
    topicIds: row.topicIds,
    sourceIds: row.sourceIds,
    coverageNote: row.coverageNote,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

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
      value: { signalCount: newSignalCount, weight: clamped } as never,
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

function extractPreferenceWeightValue(value: unknown): number {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.weight === "number") {
      return record.weight;
    }
  }
  return 0;
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

function readRequiredRuntimeEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required for credential encryption.`);
  }
  return value;
}

function readRuntimeEnv(key: string): string | undefined {
  return process.env[key];
}

export interface ByokCredentialView {
  hasKey: boolean;
  keyHint: string | null;
  baseUrl: string | null;
  provider: string | null;
  model: string | null;
}

export interface DecryptedByokCredential {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function getByokCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<ByokCredentialView> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      byokEncryptedKey: true,
      byokKeyHint: true,
      byokBaseUrl: true,
      byokProvider: true,
      byokModel: true,
    },
  });

  if (!subscription) {
    return {
      hasKey: false,
      keyHint: null,
      baseUrl: null,
      provider: null,
      model: null,
    };
  }

  return {
    hasKey: Boolean(subscription.byokEncryptedKey),
    keyHint: subscription.byokKeyHint,
    baseUrl: subscription.byokBaseUrl,
    provider: subscription.byokProvider,
    model: subscription.byokModel,
  };
}

export async function upsertByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    apiKey: string;
    baseUrl?: string;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedKey = encryptCredential(input.apiKey, encryptionKey);
  const keyHint = maskKeyHint(input.apiKey);

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      byokEncryptedKey: encryptedKey,
      byokKeyHint: keyHint,
      byokBaseUrl: input.baseUrl ?? null,
      byokProvider: input.provider ?? null,
      byokModel: input.model ?? null,
    },
    create: {
      organizationId: scope.organizationId,
      byokEncryptedKey: encryptedKey,
      byokKeyHint: keyHint,
      byokBaseUrl: input.baseUrl ?? null,
      byokProvider: input.provider ?? null,
      byokModel: input.model ?? null,
    },
  });
}

export async function deleteByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      byokEncryptedKey: null,
      byokKeyHint: null,
      byokBaseUrl: null,
      byokProvider: null,
      byokModel: null,
    },
    create: { organizationId: scope.organizationId },
  });
}

export async function getDecryptedByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedByokCredential | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      byokEncryptedKey: true,
      byokBaseUrl: true,
      byokModel: true,
    },
  });

  if (!subscription || !subscription.byokEncryptedKey) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!encryptionKey) {
    return null;
  }

  try {
    const apiKey = decryptCredential(
      subscription.byokEncryptedKey,
      encryptionKey,
    );
    return {
      apiKey,
      baseUrl: subscription.byokBaseUrl ?? "",
      model: subscription.byokModel ?? "gpt-4o-mini",
    };
  } catch {
    return null;
  }
}

export interface SubscriptionPlanView {
  plan: "FREE" | "PLUS" | "PRO";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  isSelfHosted: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export async function getSubscriptionPlanView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SubscriptionPlanView> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      plan: true,
      status: true,
      isSelfHosted: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });

  if (!subscription) {
    return {
      plan: "FREE",
      status: "ACTIVE",
      isSelfHosted: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    isSelfHosted: subscription.isSelfHosted,
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
}

export async function updateSubscriptionPlan(
  prisma: PrismaClient,
  scope: TenantScope,
  plan: "FREE" | "PLUS" | "PRO",
  periodStart?: Date | null,
  periodEnd?: Date | null,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      plan,
      currentPeriodStart: periodStart ?? undefined,
      currentPeriodEnd: periodEnd ?? undefined,
    },
    create: {
      organizationId: scope.organizationId,
      plan,
      currentPeriodStart: periodStart ?? null,
      currentPeriodEnd: periodEnd ?? null,
    },
  });
}

export async function setSelfHostedMode(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: { isSelfHosted: enabled },
    create: { organizationId: scope.organizationId, isSelfHosted: enabled },
  });
}

export async function getTodayAiCallCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const result = await prisma.usageEvent.aggregate({
    where: {
      organizationId: scope.organizationId,
      type: "AI_CALL",
      createdAt: { gte: startOfToday },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

export async function getMonthAiCallCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const result = await prisma.usageEvent.aggregate({
    where: {
      organizationId: scope.organizationId,
      type: "AI_CALL",
      createdAt: { gte: startOfMonth },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

export async function getMonthExportCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  return prisma.exportEvent.count({
    where: {
      organizationId: scope.organizationId,
      createdAt: { gte: startOfMonth },
    },
  });
}

export async function getTopicCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  return prisma.topic.count({
    where: {
      organizationId: scope.organizationId,
      status: { not: "ARCHIVED" },
    },
  });
}

export async function getActiveSourceCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  return prisma.source.count({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
  });
}

export interface CcpaymentCredentialView {
  hasSecret: boolean;
  secretHint: string | null;
  appId: string | null;
}

export async function getCcpaymentCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<CcpaymentCredentialView> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      ccpaymentAppId: true,
      ccpaymentEncryptedSecret: true,
      ccpaymentSecretHint: true,
    },
  });

  if (!subscription) {
    return { hasSecret: false, secretHint: null, appId: null };
  }

  return {
    hasSecret: Boolean(subscription.ccpaymentEncryptedSecret),
    secretHint: subscription.ccpaymentSecretHint,
    appId: subscription.ccpaymentAppId,
  };
}

export async function upsertCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { appId: string; appSecret: string },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedSecret = encryptCredential(input.appSecret, encryptionKey);
  const secretHint = maskKeyHint(input.appSecret);

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      ccpaymentAppId: input.appId,
      ccpaymentEncryptedSecret: encryptedSecret,
      ccpaymentSecretHint: secretHint,
    },
    create: {
      organizationId: scope.organizationId,
      ccpaymentAppId: input.appId,
      ccpaymentEncryptedSecret: encryptedSecret,
      ccpaymentSecretHint: secretHint,
    },
  });
}

export async function deleteCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      ccpaymentAppId: null,
      ccpaymentEncryptedSecret: null,
      ccpaymentSecretHint: null,
    },
    create: {
      organizationId: scope.organizationId,
    },
  });
}

export async function getDecryptedCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<{ appId: string; appSecret: string } | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      ccpaymentAppId: true,
      ccpaymentEncryptedSecret: true,
    },
  });

  if (!subscription || !subscription.ccpaymentAppId || !subscription.ccpaymentEncryptedSecret) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!encryptionKey) {
    return null;
  }

  try {
    const appSecret = decryptCredential(
      subscription.ccpaymentEncryptedSecret,
      encryptionKey,
    );
    return { appId: subscription.ccpaymentAppId, appSecret };
  } catch {
    return null;
  }
}

export interface PaymentInvoiceRecord {
  id: string;
  organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: number;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export async function createPaymentInvoice(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    plan: "FREE" | "PLUS" | "PRO";
    amount: number;
    currency?: string;
    provider?: string;
    providerOrderId?: string;
    invoiceUrl?: string;
    periodStart?: Date;
    periodEnd?: Date;
  },
): Promise<PaymentInvoiceRecord> {
  const invoice = await prisma.paymentInvoice.create({
    data: {
      organizationId: input.organizationId,
      plan: input.plan,
      amount: input.amount,
      currency: input.currency ?? "USD",
      status: "PENDING",
      provider: input.provider ?? "ccpayment",
      providerOrderId: input.providerOrderId ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    },
  });

  return toPaymentInvoiceRecord(invoice);
}

export async function findPaymentInvoiceByOrderId(
  prisma: PrismaClient,
  providerOrderId: string,
): Promise<PaymentInvoiceRecord | null> {
  const invoice = await prisma.paymentInvoice.findFirst({
    where: { providerOrderId },
  });

  return invoice ? toPaymentInvoiceRecord(invoice) : null;
}

export async function updatePaymentInvoiceStatus(
  prisma: PrismaClient,
  invoiceId: string,
  status: string,
  metadata?: unknown,
): Promise<void> {
  const existing = await prisma.paymentInvoice.findUnique({
    where: { id: invoiceId },
    select: { metadata: true },
  });

  const mergedMetadata =
    metadata !== undefined
      ? mergeMetadata(existing?.metadata, metadata)
      : undefined;

  await prisma.paymentInvoice.update({
    where: { id: invoiceId },
    data: {
      status,
      ...(mergedMetadata !== undefined ? { metadata: mergedMetadata as never } : {}),
    },
  });
}

function mergeMetadata(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const extra =
    incoming !== null && typeof incoming === "object" && !Array.isArray(incoming)
      ? { ...(incoming as Record<string, unknown>) }
      : {};
  return { ...base, ...extra };
}

function toPaymentInvoiceRecord(row: {
  id: string;
  organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: number;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  invoiceUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}): PaymentInvoiceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    plan: row.plan,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    invoiceUrl: row.invoiceUrl,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
