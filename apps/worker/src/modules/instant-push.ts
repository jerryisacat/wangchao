import { resolveEffectivePlan, checkInstantPushQuota } from "@wangchao/core";
import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getDecryptedTelegramCredential,
  getInstantPushSettings,
  getPrismaClient,
  listInstantPushCandidates,
  listInstantPushOrganizations,
  recordUsageEvent,
  claimInstantPush,
  markInstantPushFailed,
  markInstantPushSent,
} from "@wangchao/db";
import { TelegramDeliveryError, formatEventForInstantPush, sendTelegramMessage } from "../telegram.js";
import { readBoundedNumberEnv, readPositiveIntegerEnv, sleep } from "./env.js";
import type { InstantPushCycleResult } from "./types.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

export async function runInstantPushCycle(): Promise<InstantPushCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run instant push.");
  }
  const prisma = getPrismaClient();
  const result: InstantPushCycleResult = { organizations: 0, attempted: 0, delivered: 0, failed: 0, skipped: 0 };
  const organizations = await listInstantPushOrganizations(prisma);
  const scoreThreshold = readBoundedNumberEnv("WANGCHAO_INSTANT_PUSH_SCORE_THRESHOLD", 90, 0, 100);
  const maxPerCycle = readPositiveIntegerEnv("WANGCHAO_INSTANT_PUSH_MAX_PER_CYCLE", 10);
  const maxAttempts = readPositiveIntegerEnv("WANGCHAO_INSTANT_PUSH_MAX_ATTEMPTS", 3);

  for (const organization of organizations) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    result.organizations += 1;
    const taskRun = await createTaskRun(prisma, {
      organizationId: organization.organizationId,
      type: "TELEGRAM_INSTANT_PUSH",
      input: { scoreThreshold, maxPerCycle, maxAttempts },
    });
    try {
      const settings = await getInstantPushSettings(prisma, { organizationId: organization.organizationId });
      const effectivePlan = resolveEffectivePlan({
        plan: settings.plan,
        status: settings.status,
        isSelfHosted: settings.isSelfHosted,
        currentPeriodEnd: settings.currentPeriodEnd,
      });
      const access = checkInstantPushQuota(effectivePlan, settings.isSelfHosted);
      const credential = access.allowed
        ? await getDecryptedTelegramCredential(prisma, { organizationId: organization.organizationId })
        : null;
      if (!access.allowed || !settings.enabledAt || !credential) {
        result.skipped += 1;
        await completeTaskRun(prisma, taskRun.id, {
          outcome: "skipped",
          reason: !access.allowed ? access.reason : "Instant push is not fully configured.",
        });
        continue;
      }
      const candidates = await listInstantPushCandidates(
        prisma,
        { organizationId: organization.organizationId },
        { enabledAt: settings.enabledAt, scoreThreshold, limit: maxPerCycle },
      );
      let delivered = 0;
      let failed = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
        const claimed = await claimInstantPush(prisma, {
          eventId: candidate.eventId,
          organizationId: organization.organizationId,
          score: candidate.score,
          recipientRef: credential.chatId,
          maxAttempts,
          staleBefore: new Date(Date.now() - 30 * 60_000),
        });
        if (!claimed) {
          skipped += 1;
          continue;
        }
        result.attempted += 1;
        const eventTaskRun = await createTaskRun(prisma, {
          eventId: candidate.eventId,
          organizationId: organization.organizationId,
          type: "TELEGRAM_INSTANT_PUSH",
          input: { candidateId: candidate.eventId, provider: "telegram" },
        });
        try {
          await sendTelegramMessage(
            credential.botToken,
            credential.chatId,
            formatEventForInstantPush(candidate),
            "HTML",
          );
          await markInstantPushSent(prisma, claimed.id);
          await completeTaskRun(prisma, eventTaskRun.id, { outcome: "delivered", eventId: candidate.eventId });
          delivered += 1;
          result.delivered += 1;
        } catch (error) {
          const telegramError = error instanceof TelegramDeliveryError ? error : null;
          await markInstantPushFailed(prisma, claimed.id, {
            attempt: claimed.attempt,
            errorMessage: error instanceof Error ? error.message : "Telegram delivery failed.",
            errorCode: telegramError?.code,
            retryAfterMs: telegramError?.retryAfterMs,
            retryable: (telegramError?.retryable ?? true) && claimed.attempt < maxAttempts,
          });
          await failTaskRun(prisma, eventTaskRun.id, error);
          failed += 1;
          result.failed += 1;
        }
        await sleep(200);
      }
      if (delivered > 0 || failed > 0) {
        await recordUsageEvent(prisma, {
          organizationId: organization.organizationId,
          userId: organization.userId ?? undefined,
          type: "INSTANT_PUSH",
          quantity: delivered,
          unit: "delivery",
          subjectType: "instant-push-cycle",
          metadata: { attempted: delivered + failed, delivered, failed, skipped },
        });
      }
      result.skipped += skipped;
      await completeTaskRun(prisma, taskRun.id, { outcome: "completed", delivered, failed, skipped });
    } catch (error) {
      result.failed += 1;
      await failTaskRun(prisma, taskRun.id, error);
    }
  }
  return result;
}
