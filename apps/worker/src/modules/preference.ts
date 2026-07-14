import { generatePreferenceDeltas } from "@wangchao/core";
import {
  getPrismaClient,
  listRecentFeedbackSignals,
  upsertPreferenceMemory,
} from "@wangchao/db";

export async function runPreferenceLearningCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const signals = await listRecentFeedbackSignals(prisma, {
    organizationId,
    userId,
  });
  const deltas = generatePreferenceDeltas(signals);

  await Promise.all(
    deltas.map((delta) =>
      upsertPreferenceMemory(prisma, {
        confidence: delta.confidence,
        explanation: delta.explanation,
        key: delta.key,
        organizationId,
        topicId: delta.topicId,
        userId,
        value: delta.value,
      }),
    ),
  );

  return deltas.length;
}
