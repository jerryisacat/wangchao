import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getDecryptedTelegramCredential,
  getPrismaClient,
  type CreateTaskRunInput,
  type DeliveryLogRecord,
} from "@wangchao/db";
import {
  DELIVERY_MAX_ATTEMPTS,
  claimDeliveryLog,
  findBriefingsForTelegramDelivery,
  markDeliveryFailed,
  markDeliverySent,
} from "@wangchao/db";
import { sendTelegramMessage } from "../telegram.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import type { TelegramDeliveryResult } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

const TELEGRAM_DELIVERY_LOOKBACK_HOURS = 2;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export interface TelegramDeliveryDeps {
  prisma: PrismaClient;
  findBriefingsForTelegramDelivery: (
    prisma: PrismaClient,
    scope: { organizationId: string },
    since: Date,
  ) => Promise<
    Array<{
      briefingId: string;
      briefingTitle: string;
      markdown: string | null;
      topicName: string;
      period: string;
    }>
  >;
  claimDeliveryLog: (
    prisma: PrismaClient,
    input: {
      briefingId: string;
      organizationId: string;
      channel: "TELEGRAM";
      recipientRef: string;
      maxAttempts?: number;
      now?: Date;
    },
  ) => Promise<DeliveryLogRecord | null>;
  markDeliverySent: (prisma: PrismaClient, logId: string, input?: { metadata?: unknown }) => Promise<void>;
  markDeliveryFailed: (
    prisma: PrismaClient,
    logId: string,
    input: {
      attempt: number;
      errorMessage: string;
      errorCode?: string | null;
      maxAttempts?: number;
    },
  ) => Promise<{ finalized: boolean; retryable: boolean }>;
  getDecryptedTelegramCredential: (
    prisma: PrismaClient,
    scope: { organizationId: string },
  ) => Promise<{ botToken: string; chatId: string } | null>;
  sendTelegramMessage: (
    botToken: string,
    chatId: string,
    message: string,
    parseMode?: "Markdown" | "HTML",
  ) => Promise<void>;
  createTaskRun: (
    prisma: PrismaClient,
    input: CreateTaskRunInput,
  ) => Promise<{ id: string }>;
  completeTaskRun: (
    prisma: PrismaClient,
    taskRunId: string,
    output: Record<string, unknown>,
  ) => Promise<void>;
  failTaskRun: (prisma: PrismaClient, taskRunId: string, error: unknown) => Promise<void>;
  now: () => Date;
}

/**
 * Build the default production wiring for runTelegramDeliveryCycle. Each real
 * function is wrapped so the dep surface stays a narrow contract (and so the
 * two PrismaClient type instantiations - db package vs worker package - don't
 * trip structural comparison). Tests inject a Partial<TelegramDeliveryDeps>.
 */
function buildDefaultDeps(prisma: PrismaClient): TelegramDeliveryDeps {
  return {
    prisma,
    findBriefingsForTelegramDelivery: (p, scope, since) => findBriefingsForTelegramDelivery(p, scope, since),
    claimDeliveryLog: (p, input) => claimDeliveryLog(p, input),
    markDeliverySent: (p, id, input) => markDeliverySent(p, id, input),
    markDeliveryFailed: (p, id, input) => markDeliveryFailed(p, id, input),
    getDecryptedTelegramCredential: (p, scope) =>
      getDecryptedTelegramCredential(p, scope) as Promise<{ botToken: string; chatId: string } | null>,
    sendTelegramMessage: (token, chatId, text, parseMode) => sendTelegramMessage(token, chatId, text, parseMode),
    createTaskRun: (p, input) => createTaskRun(p, input).then((r) => ({ id: r.id })),
    completeTaskRun: (p, id, output) => completeTaskRun(p, id, output).then(() => undefined),
    failTaskRun: (p, id, error) => failTaskRun(p, id, error).then(() => undefined),
    now: () => new Date(),
  };
}

export async function runTelegramDeliveryCycle(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  depsOverride?: Partial<TelegramDeliveryDeps>,
): Promise<TelegramDeliveryResult> {
  const deps: TelegramDeliveryDeps = { ...buildDefaultDeps(prisma), ...depsOverride };
  return runTelegramDeliveryCycleWithDeps(deps, organizationId, userId);
}

async function runTelegramDeliveryCycleWithDeps(
  d: TelegramDeliveryDeps,
  organizationId: string,
  _userId: string,
): Promise<TelegramDeliveryResult> {
  const result: TelegramDeliveryResult = { delivered: 0, failed: 0, skipped: 0, retried: 0 };

  const credential = await d.getDecryptedTelegramCredential(d.prisma, { organizationId });
  if (!credential) {
    return result;
  }

  const since = new Date(d.now().getTime() - TELEGRAM_DELIVERY_LOOKBACK_HOURS * 60 * 60_000);

  const briefings = await d.findBriefingsForTelegramDelivery(
    d.prisma,
    { organizationId },
    since,
  );

  if (briefings.length === 0) {
    return result;
  }

  for (const briefing of briefings) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;

    const claimed = await d.claimDeliveryLog(d.prisma, {
      briefingId: briefing.briefingId,
      organizationId,
      channel: "TELEGRAM",
      recipientRef: credential.chatId,
      maxAttempts: DELIVERY_MAX_ATTEMPTS,
      now: d.now(),
    });
    if (!claimed) {
      // Already SENT/SKIPPED (idempotent skip), exhausted attempts, or still
      // within the backoff window — try the next briefing.
      result.skipped += 1;
      continue;
    }

    if (claimed.attempt > 1) {
      result.retried += 1;
    }

    const taskRun = await d.createTaskRun(d.prisma, {
      input: {
        briefingId: briefing.briefingId,
        channel: "TELEGRAM",
        chatId: credential.chatId,
        deliveryLogId: claimed.id,
        attempt: claimed.attempt,
      },
      organizationId,
      type: "TELEGRAM_DELIVERY",
    });

    try {
      const markdown = briefing.markdown ?? "";
      const messageText = formatBriefingForTelegram(
        markdown,
        briefing.briefingTitle,
        briefing.topicName,
      );

      await d.sendTelegramMessage(
        credential.botToken,
        credential.chatId,
        messageText,
      );
      await d.markDeliverySent(d.prisma, claimed.id);
      await d.completeTaskRun(d.prisma, taskRun.id, {
        briefingId: briefing.briefingId,
        outcome: "sent",
      });
      result.delivered += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = extractTelegramErrorCode(error);

      const failed = await d.markDeliveryFailed(d.prisma, claimed.id, {
        attempt: claimed.attempt,
        errorMessage,
        errorCode,
        maxAttempts: DELIVERY_MAX_ATTEMPTS,
      });
      await d.failTaskRun(d.prisma, taskRun.id, error);
      result.failed += 1;
      if (failed.finalized) {
        // Marked SKIPPED permanently; reported in `failed` but no further retry.
      }
    }
  }

  return result;
}

function formatBriefingForTelegram(
  markdown: string,
  title: string,
  topicName: string,
): string {
  const header = `📰 *${escapeTelegramMarkdown(title)}*\n`;
  const body = markdown
    .replace(/^---[\s\S]*?---\n?/m, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();

  const full = `${header}\n${body}`;
  if (full.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return full;
  }

  return `${full.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20)}\n\n…（已截断）`;
}

function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[*_`\[\]]/g, "\\$&");
}

function extractTelegramErrorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : String(code);
  }
  return null;
}

// Re-export the record type for fixtures/tests that need to construct
// DeliveryLogRecord-shaped fakes without importing from @wangchao/db directly.
export type { DeliveryLogRecord };