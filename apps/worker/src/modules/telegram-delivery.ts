import {
  completeTaskRun,
  createDeliveryLog,
  createTaskRun,
  failTaskRun,
  findBriefingsForTelegramDelivery,
  findPendingDeliveryForBriefing,
  getDecryptedTelegramCredential,
  getPrismaClient,
  updateDeliveryLog,
} from "@wangchao/db";
import { sendTelegramMessage } from "../telegram.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import type { TelegramDeliveryResult } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

const TELEGRAM_DELIVERY_LOOKBACK_HOURS = 2;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export async function runTelegramDeliveryCycle(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<TelegramDeliveryResult> {
  const result: TelegramDeliveryResult = { delivered: 0, failed: 0, skipped: 0 };

  const credential = await getDecryptedTelegramCredential(prisma, { organizationId });
  if (!credential) {
    return result;
  }

  const since = new Date();
  since.setUTCHours(since.getUTCHours() - TELEGRAM_DELIVERY_LOOKBACK_HOURS);

  const briefings = await findBriefingsForTelegramDelivery(
    prisma,
    { organizationId },
    since,
  );

  if (briefings.length === 0) {
    return result;
  }

  for (const briefing of briefings) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const existing = await findPendingDeliveryForBriefing(
      prisma,
      briefing.briefingId,
      "TELEGRAM",
    );
    if (existing && (existing.status === "SENT" || existing.status === "SKIPPED")) {
      result.skipped += 1;
      continue;
    }

    const deliveryLog = existing ?? await createDeliveryLog(prisma, {
      organizationId,
      briefingId: briefing.briefingId,
      channel: "TELEGRAM",
      status: "PENDING",
      recipientRef: credential.chatId,
    });

    const taskRun = await createTaskRun(prisma, {
      input: {
        briefingId: briefing.briefingId,
        channel: "TELEGRAM",
        chatId: credential.chatId,
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

      await sendTelegramMessage(
        credential.botToken,
        credential.chatId,
        messageText,
      );

      await updateDeliveryLog(prisma, deliveryLog.id, {
        status: "SENT",
        attempt: deliveryLog.attempt + 1,
      });
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.briefingId,
        outcome: "sent",
      });
      result.delivered += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = extractTelegramErrorCode(error);

      await updateDeliveryLog(prisma, deliveryLog.id, {
        status: "FAILED",
        attempt: deliveryLog.attempt + 1,
        errorMessage,
        errorCode,
      });
      await failTaskRun(prisma, taskRun.id, error);
      result.failed += 1;
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
