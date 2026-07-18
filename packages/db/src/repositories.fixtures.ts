import type { PrismaClient } from "@prisma/client";
import {
  completeTaskRun,
  createDailyBriefing,
  createTaskRun,
  failTaskRun,
  applyAutomaticSourceGovernance,
  getSourceQualitySummary,
  listBriefingsPage,
  listDashboardEvents,
  listEventsForDailyBriefing,
  listFetchedItemsForAnalysis,
  listRecentFeedbackSignals,
  listSavedDashboardEvents,
  listSourceGovernanceReport,
  mergeSemanticEvents,
  recordCategoryPreferenceFeedback,
  recordSourceQualityObservation,
  updateDashboardEventState,
  markBriefingEventsRead,
  updateTopic,
  upsertIntelligenceEventFromItem,
  recommendCandidatePromotion,
  computeCandidateQualityMetrics,
  SOURCE_QUALITY_MIN_SAMPLE,
} from "./repositories.js";
import {
  getInstantPushSettings,
  listInstantPushOrganizations,
  setInstantPushEnabled,
} from "./repositories/instant-push.js";
import {
  cryptoSmokeTest,
  decryptCredential,
  encryptCredential,
} from "./crypto.js";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

export async function runRepositoryFixtures(): Promise<void> {
  await verifyCryptoRoundTrip();
  await verifyCryptoSmokeTestExecutes();
  await verifySavedPagination();
  await verifyUserReadDoesNotLeakToOtherUserViaEventStatus();
  await verifyUserDismissDoesNotLeakToOtherUserViaEventStatus();
  await verifyDashboardFeedDerivesUnreadFromCurrentUserState();
  await verifyDashboardRecordDerivesUserStateNotGlobalStatus();
  await verifyReadPreservesSavedState();
  await verifyMarkBriefingEventsReadBatchesUserItemState();
  await verifyMarkBriefingEventsReadIsIdempotentAndReportsSkipped();
  await verifyMarkBriefingEventsReadPreservesSavedEvents();
  await verifyMarkBriefingEventsReadDoesNotLeakAcrossUsers();
  await verifyMarkBriefingEventsReadIsOrganizationScoped();
  await verifyMarkBriefingEventsReadNoNPlusOne();
  await verifyCategoryFeedbackIsPersistedAndLearned();
  await verifyFeedbackSignalMapperPreservesContractFields();
  await verifyTopicUpdateAndAnalysisContextStayTenantScoped();
  await verifyDailyBriefingWindowFilter();
  await verifyDailyBriefingUpsert();
  await verifyBriefingHistoryPagination();
  await verifyTaskRunLifecycle();
  await verifySourceGovernanceMetricsUseActiveEventLinks();
  await verifySourceQualityScoreIsPersistedToSource();
  await verifyAutomaticGovernanceDoesNotMuteSmallSample();
  await verifyAutomaticGovernanceMutesLowQualityLargeSample();
  await verifyAutomaticGovernanceDoesNotAutoReject();
  await verifyGovernanceReportExposesPersistedAndDerivedQualityScore();
  await verifyGetSourceQualitySummaryReadsPersistedValue();
  await verifyRecommendCandidatePromotionContract();
  await verifyComputeCandidateQualityMetricsAggregatesBySource();
  await verifyFuzzyEventMatchUpdatesExistingEvent();
  await verifySemanticMergeClearsArchivedMatchKeys();
  await verifyInstantPushSettingsUseTelegramCredential();
}

async function verifyInstantPushSettingsUseTelegramCredential(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const enabledAt = new Date("2026-07-16T00:00:00.000Z");
  const prisma = {
    organizationCredential: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "organizationCredential.findMany" });
        return [
          {
            organizationId: "org-1",
            organization: { memberships: [{ userId: "user-1" }] },
          },
        ];
      },
      findUnique: async (args: unknown) => {
        calls.push({ args, method: "organizationCredential.findUnique" });
        return {
          chatId: "chat-1",
          encryptedKey: "encrypted-token",
          instantPushEnabled: true,
          instantPushEnabledAt: enabledAt,
        };
      },
      upsert: async (args: unknown) => {
        calls.push({ args, method: "organizationCredential.upsert" });
        return {};
      },
    },
    subscription: {
      findUnique: async (args: unknown) => {
        calls.push({ args, method: "subscription.findUnique" });
        return {
          currentPeriodEnd: null,
          isSelfHosted: false,
          plan: "PRO",
          status: "ACTIVE",
        };
      },
    },
  } as unknown as PrismaClient;

  const settings = await getInstantPushSettings(prisma, { organizationId: "org-1" });
  assert(settings.enabled, "Instant push enablement must come from the Telegram credential.");
  assert(settings.enabledAt === enabledAt, "Instant push enabledAt must come from the Telegram credential.");
  assert(settings.hasTelegramCredential, "Telegram credential presence must be detected.");

  await setInstantPushEnabled(prisma, { organizationId: "org-1" }, true);
  const upsert = readArgsByName(calls, "organizationCredential.upsert");
  const upsertWhere = readRecord(upsert.where, "instantPush.upsert.where");
  const credentialKey = readRecord(
    upsertWhere.organizationId_credentialType,
    "instantPush.upsert.credentialKey",
  );
  assert(credentialKey.organizationId === "org-1", "Instant push setting must remain tenant scoped.");
  assert(credentialKey.credentialType === "TELEGRAM", "Instant push setting must target the Telegram credential.");
  const upsertUpdate = readRecord(upsert.update, "instantPush.upsert.update");
  assert(upsertUpdate.instantPushEnabled === true, "Instant push setting must be enabled.");
  assert(upsertUpdate.instantPushEnabledAt === enabledAt, "Existing enablement boundary must be preserved.");

  const organizations = await listInstantPushOrganizations(prisma);
  const findMany = readArgsByName(calls, "organizationCredential.findMany");
  const findManyWhere = readRecord(findMany.where, "instantPush.findMany.where");
  assert(findManyWhere.credentialType === "TELEGRAM", "Instant push scan must only use Telegram credentials.");
  assert(findManyWhere.instantPushEnabled === true, "Instant push scan must only use enabled credentials.");
  assert(organizations[0]?.userId === "user-1", "Instant push scan must retain the organization owner.");
}

async function verifyTopicUpdateAndAnalysisContextStayTenantScoped(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    item: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "item.findMany" });
        return [
          {
            fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
            id: "item-1",
            organizationId: "org-1",
            publishedAt: null,
            sourceId: "source-1",
            source: { name: "Source One" },
            contentErrorCode: null,
            contentStatus: "READY",
            summary: "Summary",
            title: "Title",
            topic: {
              description: "Current description",
              name: "Current topic name",
              profile: { keywords: ["AI"] },
            },
            topicId: "topic-1",
            url: "https://example.com/item",
          },
        ];
      },
    },
    topic: {
      findFirst: async (_args: unknown) => ({ id: "topic-1", organizationId: "org-1" }),
      update: async (args: unknown) => {
        calls.push({ args, method: "topic.update" });
        return {};
      },
    },
  } as unknown as PrismaClient;

  await updateTopic(
    prisma,
    { organizationId: "org-1", topicId: "topic-1" },
    {
      name: "Updated topic",
      profile: { keywords: ["AI", "Agent"] },
    },
  );
  const [item] = await listFetchedItemsForAnalysis(prisma, {
    organizationId: "org-1",
  });

  const updateArgs = readArgsByName(calls, "topic.update");
  const updateWhere = readRecord(updateArgs.where, "topic.update.where");
  assert(updateWhere.id === "topic-1", "Topic update must target the requested topic.");
  assert(
    updateWhere.organizationId === "org-1",
    "Topic update must include the organization boundary.",
  );
  const findArgs = readArgsByName(calls, "item.findMany");
  const include = readRecord(findArgs.include, "analysisItems.include");
  const analysisWhere = readRecord(findArgs.where, "analysisItems.where");
  const activeSource = readRecord(analysisWhere.source, "analysisItems.where.source");
  const topic = readRecord(include.topic, "analysisItems.include.topic");
  const select = readRecord(topic.select, "analysisItems.include.topic.select");
  assert(select.name === true, "Analysis item query must load the current topic name.");
  assert(activeSource.status === "ACTIVE", "Candidate-source items must not enter analysis.");
  assert(
    select.description === true,
    "Analysis item query must load the current topic description.",
  );
  assert(item?.topicName === "Current topic name", "Analysis item must expose topic name.");
  assert(item?.sourceName === "Source One", "Analysis item must expose source name.");
  assert(
    item?.topicDescription === "Current description",
    "Analysis item must expose topic description.",
  );
}

async function verifyCategoryFeedbackIsPersistedAndLearned(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    feedbackEvent: {
      create: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.create" });
        return {};
      },
      findMany: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.findMany" });
        return [
          {
            id: "fb-cat-1",
            createdAt: new Date("2026-07-18T00:00:00.000Z"),
            eventId: "event-1",
            sourceId: null,
            kind: "CATEGORY_UP",
            topicId: "topic-1",
            value: 2,
            event: {
              category: "AI",
              primaryItem: {
                source: { name: "Source One" },
                sourceId: "source-1",
              },
            },
            source: null,
          },
        ];
      },
    },
    intelligenceEvent: {
      findFirstOrThrow: async () => ({
        category: "AI",
        id: "event-1",
        primaryItemId: "item-1",
        topicId: "topic-1",
      }),
    },
  } as unknown as PrismaClient;

  await recordCategoryPreferenceFeedback(prisma, {
    action: "up",
    eventId: "event-1",
    organizationId: "org-1",
    userId: "user-1",
  });
  const [signal] = await listRecentFeedbackSignals(prisma, {
    organizationId: "org-1",
    userId: "user-1",
  });

  const createData = readRecord(
    readArgsByName(calls, "feedbackEvent.create").data,
    "categoryFeedback.create.data",
  );
  assert(createData.kind === "CATEGORY_UP", "Category-up must use its dedicated feedback kind.");
  assert(createData.value === 2, "Category-up must persist a positive preference value.");
  const findArgs = readArgsByName(calls, "feedbackEvent.findMany");
  const where = readRecord(findArgs.where, "feedbackSignals.where");
  const kind = readRecord(where.kind, "feedbackSignals.where.kind");
  const kinds = kind.in as unknown[];
  assert(kinds.includes("CATEGORY_UP"), "Preference learning must query category-up feedback.");
  assert(kinds.includes("CATEGORY_DOWN"), "Preference learning must query category-down feedback.");
  assert(signal?.kind === "CATEGORY_UP", "Category feedback must reach the learning signal mapper.");
  assert(signal?.category === "AI", "Category feedback must retain the event category.");
}

/**
 * Issue #164: listRecentFeedbackSignals must return the full FeedbackSignalRecord
 * contract (feedbackEventId, eventId, createdAt, topic/source/category/value) and
 * must not swallow enhanced feedback kinds (SCORE_*, SOURCE_QUALITY_*, MORE/LESS_LIKE_THIS)
 * nor merge cross-topic signals when eventId is absent.
 *
 * The mock below mirrors the real Prisma FeedbackEvent row shape (scalar fields are
 * returned by default; relations are gated by `include`). Enhanced feedback such as
 * SOURCE_QUALITY_UP typically has no bound IntelligenceEvent, so the mapper must fall
 * back to FeedbackEvent.sourceId.
 */
async function verifyFeedbackSignalMapperPreservesContractFields(): Promise<void> {
  const capturedWhereKinds: string[] = [];
  const createdAtA = new Date("2026-06-17T00:00:00.000Z");
  const createdAtB = new Date("2026-07-18T00:00:00.000Z");

  const mockedRows = [
    {
      // DISMISS bound to an IntelligenceEvent (classic case).
      id: "fb-dismiss-1",
      createdAt: createdAtA,
      eventId: "event-1",
      sourceId: null,
      kind: "DISMISS",
      topicId: "topic-1",
      value: null,
      event: {
        category: "AI",
        primaryItem: {
          sourceId: "source-via-event",
          source: { name: "Source Via Event" },
        },
      },
      source: null,
    },
    {
      // SOURCE_QUALITY_UP with no IntelligenceEvent — must read FeedbackEvent.sourceId.
      id: "fb-sq-up-1",
      createdAt: createdAtB,
      eventId: null,
      sourceId: "source-direct",
      kind: "SOURCE_QUALITY_UP",
      topicId: "topic-2",
      value: null,
      event: null,
      source: { name: "Source Direct" },
    },
    {
      // SCORE_UP on a different topic — must not be swallowed or merged.
      id: "fb-score-up-1",
      createdAt: createdAtB,
      eventId: "event-3",
      sourceId: null,
      kind: "SCORE_UP",
      topicId: "topic-3",
      value: null,
      event: {
        category: "Policy",
        primaryItem: {
          sourceId: null,
          source: { name: null },
        },
      },
      source: null,
    },
  ] as unknown as Awaited<ReturnType<PrismaClient["feedbackEvent"]["findMany"]>>;

  const prisma = {
    feedbackEvent: {
      findMany: async (args: { where?: { kind?: { in?: unknown[] } } }) => {
        const kinds = args.where?.kind?.in;
        if (Array.isArray(kinds)) {
          capturedWhereKinds.push(...(kinds as string[]));
        }
        return mockedRows;
      },
    },
  } as unknown as PrismaClient;

  const signals = await listRecentFeedbackSignals(prisma, {
    organizationId: "org-1",
    userId: "user-1",
  });

  // 1. Enhanced feedback kinds must be queried, not filtered out.
  const requiredKinds = [
    "READ",
    "SAVE",
    "DISMISS",
    "EXPORT",
    "CATEGORY_UP",
    "CATEGORY_DOWN",
    "MORE_LIKE_THIS",
    "LESS_LIKE_THIS",
    "SOURCE_QUALITY_UP",
    "SOURCE_QUALITY_DOWN",
    "SCORE_UP",
    "SCORE_DOWN",
  ];
  for (const kind of requiredKinds) {
    assert(
      capturedWhereKinds.includes(kind),
      `Preference learning must query ${kind} feedback (got: ${capturedWhereKinds.join(",")}).`,
    );
  }
  assert(
    !capturedWhereKinds.includes("SOURCE_APPROVE") &&
      !capturedWhereKinds.includes("SOURCE_REJECT"),
    "Governance-only feedback (SOURCE_APPROVE/REJECT) must not enter personal preference learning.",
  );

  // 2. All three signals must survive — no cross-topic or enhanced-kind swallowing.
  assert(signals.length === 3, `Expected 3 signals, got ${signals.length}.`);
  const dismiss = signals.find((s) => s.feedbackEventId === "fb-dismiss-1");
  const quality = signals.find((s) => s.feedbackEventId === "fb-sq-up-1");
  const score = signals.find((s) => s.feedbackEventId === "fb-score-up-1");
  assert(dismiss !== undefined, "DISMISS signal must be present.");
  assert(quality !== undefined, "SOURCE_QUALITY_UP signal must not be swallowed.");
  assert(score !== undefined, "SCORE_UP signal must not be swallowed.");

  // 3. Contract fields must be populated.
  assert(dismiss?.eventId === "event-1", "DISMISS must carry its eventId.");
  assert(
    dismiss?.createdAt.toISOString() === createdAtA.toISOString(),
    "DISMISS must carry its createdAt for time decay.",
  );
  assert(dismiss?.topicId === "topic-1", "DISMISS must carry its topicId.");
  assert(dismiss?.category === "AI", "DISMISS must carry event category.");
  assert(
    dismiss?.sourceId === "source-via-event",
    "DISMISS must read sourceId via the bound IntelligenceEvent.",
  );
  assert(
    dismiss?.sourceName === "Source Via Event",
    "DISMISS must read sourceName via the bound IntelligenceEvent.",
  );

  // 4. Enhanced feedback with no IntelligenceEvent must fall back to FeedbackEvent.sourceId.
  assert(quality?.eventId === null, "SOURCE_QUALITY_UP without event must expose null eventId, not undefined.");
  assert(
    quality?.createdAt.toISOString() === createdAtB.toISOString(),
    "SOURCE_QUALITY_UP must carry its createdAt.",
  );
  assert(quality?.topicId === "topic-2", "SOURCE_QUALITY_UP must carry its topicId.");
  assert(
    quality?.sourceId === "source-direct",
    "SOURCE_QUALITY_UP must fall back to FeedbackEvent.sourceId when no event is bound.",
  );
  assert(
    quality?.sourceName === "Source Direct",
    "SOURCE_QUALITY_UP must read source name from the FeedbackEvent.source relation.",
  );

  // 5. Missing identifiers must degrade safely (null, not crash).
  assert(score?.eventId === "event-3", "SCORE_UP must carry its eventId.");
  assert(score?.category === "Policy", "SCORE_UP must carry event category.");
  assert(score?.sourceId === null, "SCORE_UP with no source must expose null, not undefined.");
  assert(score?.sourceName === null, "SCORE_UP with no source name must expose null.");

  // 6. feedbackEventId must always be non-null (it is the dedup primary key).
  assert(
    signals.every((s) => typeof s.feedbackEventId === "string" && s.feedbackEventId.length > 0),
    "Every signal must carry a non-empty feedbackEventId for idempotent dedup.",
  );
}

async function verifySavedPagination(): Promise<void> {
  const calls: Array<{ args: unknown; method: "count" | "findMany" }> = [];
  const prisma = {
    intelligenceEvent: {
      count: async (args: unknown) => {
        calls.push({ args, method: "count" });
        return 65;
      },
      findMany: async (args: unknown) => {
        calls.push({ args, method: "findMany" });
        return [];
      },
    },
  } as unknown as PrismaClient;

  const result = await listSavedDashboardEvents(
    prisma,
    { organizationId: "org-1", userId: "user-1" },
    99,
    30,
  );

  assert(result.page === 3, `Expected page 3, received ${result.page}.`);
  assert(result.pageCount === 3, `Expected 3 pages, received ${result.pageCount}.`);
  assert(result.total === 65, `Expected 65 saved events, received ${result.total}.`);
  assert(result.events.length === 0, "The empty mocked result should stay empty.");

  const countArgs = readArgs(calls, "count");
  const findArgs = readArgs(calls, "findMany");
  const countWhere = readRecord(countArgs.where, "count.where");
  const userStates = readRecord(countWhere.userStates, "count.where.userStates");
  const some = readRecord(userStates.some, "count.where.userStates.some");

  assert(countWhere.organizationId === "org-1", "Saved query must stay tenant-scoped.");
  assert(some.userId === "user-1", "Saved query must stay user-scoped.");
  assert(some.saved === true, "Saved query must require UserItemState.saved=true.");
  assert(findArgs.skip === 60, `Expected offset 60, received ${String(findArgs.skip)}.`);
  assert(findArgs.take === 30, `Expected page size 30, received ${String(findArgs.take)}.`);
}

async function verifyUserReadDoesNotLeakToOtherUserViaEventStatus(): Promise<void> {
  // SPEC §5.5: 个人阅读状态完全由 UserItemState 承载，IntelligenceEvent.status
  // 回归为事件生命周期。用户 A read 后不得写 IntelligenceEvent.status，否则
  // 用户 B 的信息流被污染。
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    feedbackEvent: {
      create: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.create" });
        return {};
      },
    },
    intelligenceEvent: {
      findFirstOrThrow: async () => ({
        id: "event-1",
        organizationId: "org-1",
        primaryItemId: "item-1",
        topicId: "topic-1",
        userStates: [{ readAt: null, saved: false }],
      }),
      update: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.update" });
        return {};
      },
    },
    userItemState: {
      upsert: async (args: unknown) => {
        calls.push({ args, method: "userItemState.upsert" });
        return {};
      },
    },
  } as unknown as PrismaClient;

  await updateDashboardEventState(prisma, {
    action: "read",
    eventId: "event-1",
    organizationId: "org-1",
    userId: "user-A",
  });

  const eventUpdates = calls.filter((c) => c.method === "intelligenceEvent.update");
  assert(
    eventUpdates.length === 0,
    "SPEC §5.5 违规：用户 A read 不应再写 IntelligenceEvent.status（会泄漏到用户 B）。" +
      `观察到 ${eventUpdates.length} 次 intelligenceEvent.update 调用。`,
  );

  const userUpsert = readArgsByName(calls, "userItemState.upsert");
  const userUpdate = readRecord(userUpsert.update, "userItemState.upsert.update");
  assert(
    userUpdate.status === "READ",
    "UserItemState.status 必须记录用户 A 的个人阅读状态 READ。",
  );
  assert(
    userUpdate.readAt instanceof Date,
    "UserItemState.readAt 必须记录阅读时间。",
  );
}

async function verifyUserDismissDoesNotLeakToOtherUserViaEventStatus(): Promise<void> {
  // SPEC §5.5: DISMISSED 是个人阅读状态，不得写 IntelligenceEvent.status。
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    feedbackEvent: {
      create: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.create" });
        return {};
      },
    },
    intelligenceEvent: {
      findFirstOrThrow: async () => ({
        id: "event-1",
        organizationId: "org-1",
        primaryItemId: "item-1",
        topicId: "topic-1",
        userStates: [{ readAt: null, saved: false }],
      }),
      update: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.update" });
        return {};
      },
    },
    userItemState: {
      upsert: async (args: unknown) => {
        calls.push({ args, method: "userItemState.upsert" });
        return {};
      },
    },
  } as unknown as PrismaClient;

  await updateDashboardEventState(prisma, {
    action: "dismiss",
    eventId: "event-1",
    organizationId: "org-1",
    userId: "user-A",
  });

  const eventUpdates = calls.filter((c) => c.method === "intelligenceEvent.update");
  assert(
    eventUpdates.length === 0,
    "SPEC §5.5 违规：用户 A dismiss 不应再写 IntelligenceEvent.status。",
  );

  const userUpsert = readArgsByName(calls, "userItemState.upsert");
  const userUpdate = readRecord(userUpsert.update, "userItemState.upsert.update");
  assert(
    userUpdate.status === "DISMISSED",
    "UserItemState.status 必须记录用户 A 的个人 DISMISSED 状态。",
  );
}

async function verifyDashboardFeedDerivesUnreadFromCurrentUserState(): Promise<void> {
  // SPEC §5.5: 主信息流（listDashboardEvents）必须按当前用户 UserItemState 派生，
  // 不得用 IntelligenceEvent.status in [UNREAD,SAVED] 全局过滤。
  // 用户 A 已 read/dimiss 的事件，对用户 B 仍应可见。
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    intelligenceEvent: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "findMany" });
        return [];
      },
    },
  } as unknown as PrismaClient;

  await listDashboardEvents(
    prisma,
    { organizationId: "org-1", userId: "user-B" },
    30,
  );

  assert(calls.length === 1, "listDashboardEvents 应只发一次 findMany。");
  const args = readArgsByName(calls, "findMany");
  const where = readRecord(args.where, "findMany.where");

  // SPEC §5.5: 禁止用全局 IntelligenceEvent.status 过滤个人阅读状态（隔离泄漏根因）。
  // 允许的：status: { notIn: ["ARCHIVED"] }（组织级归档生命周期，合法）。
  // 禁止的：status: { in: [...] } 把 READ/SAVED/DISMISSED 当全局用。
  const statusFilter = where.status as Record<string, unknown> | undefined;
  if (statusFilter && Array.isArray(statusFilter.in)) {
    const personalStatesInGlobalFilter = (statusFilter.in as string[]).filter(
      (s) => s === "READ" || s === "SAVED" || s === "DISMISSED",
    );
    assert(
      personalStatesInGlobalFilter.length === 0,
      "SPEC §5.5 违规：listDashboardEvents 不得用 IntelligenceEvent.status in [READ/SAVED/DISMISSED] " +
        "全局过滤主信息流（个人状态泄漏）。观察到 where.status=" +
        JSON.stringify(where.status),
    );
  }

  // 必须有 userStates 过滤，按当前 userId 派生。
  // 这里不严格断言是 some/none 哪种结构，只要证明派生自当前用户即可。
  const hasUserStateFilter =
    where.userStates !== undefined || where.NOT !== undefined;
  assert(
    hasUserStateFilter,
    "listDashboardEvents 必须包含 userStates 或 NOT 子句以按当前用户派生阅读状态。",
  );

  // include 必须带 userStates（按当前 userId 过滤），用于派生 userStatus/userSaved。
  const include = readRecord(args.include, "findMany.include");
  assert(
    include.userStates !== undefined,
    "listDashboardEvents 必须 include userStates 以派生当前用户状态。",
  );
}

async function verifyDashboardRecordDerivesUserStateNotGlobalStatus(): Promise<void> {
  // SPEC §5.5: DashboardEventRecord.userSaved 必须只来自当前用户 UserItemState.saved，
  // 不得 fallback 到 IntelligenceEvent.status === "SAVED"。
  // 当 UserItemState 不存在（新事件、新用户）时，userSaved 必须是 false、
  // userStatus 必须是 null（派生为 UNREAD），而不是继承全局 status。
  const prisma = {
    intelligenceEvent: {
      findMany: async () => [
        {
          id: "event-1",
          organizationId: "org-1",
          topicId: "topic-1",
          primaryItemId: null,
          // 全局 status 仍是 SAVED（旧全局写入遗留），但当前用户没有 UserItemState。
          status: "SAVED",
          title: "t",
          summary: "s",
          summaryStatus: "READY",
          category: null,
          score: 0,
          gravityScore: 0,
          eventHash: null,
          titleHash: null,
          explanation: null,
          entities: [],
          followUpSuggestion: null,
          mergeReason: null,
          occurredAt: null,
          updatedAt: new Date(),
          topic: { name: "Topic" },
          primaryItem: null,
          eventItems: [],
          userStates: [],
        },
      ],
    },
  } as unknown as PrismaClient;

  const events = await listDashboardEvents(
    prisma,
    { organizationId: "org-1", userId: "user-B" },
    30,
  );

  assert(events.length === 1, "应返回 1 条事件。");
  const record = events[0]!;
  assert(
    record.userSaved === false,
    "SPEC §5.5 违规：userSaved 必须只来自当前用户 UserItemState.saved。" +
      "当用户 B 没有 UserItemState 时，即使全局 status=SAVED，userSaved 也必须是 false。" +
      `观察到 userSaved=${String(record.userSaved)}。`,
  );
}

async function verifyReadPreservesSavedState(): Promise<void> {
  // SPEC §5.5: 对已收藏事件执行 read 保留 saved=true，status 保持 SAVED（双轨）。
  // 新契约（#172）：read 只写 UserItemState + FeedbackEvent，不写 IntelligenceEvent.status。
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    feedbackEvent: {
      create: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.create" });
        return {};
      },
    },
    intelligenceEvent: {
      findFirstOrThrow: async () => ({
        id: "event-1",
        organizationId: "org-1",
        primaryItemId: "item-1",
        topicId: "topic-1",
        userStates: [{ readAt: null, saved: true, status: "SAVED" }],
      }),
      update: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.update" });
        return {};
      },
    },
    userItemState: {
      upsert: async (args: unknown) => {
        calls.push({ args, method: "userItemState.upsert" });
        return {};
      },
    },
  } as unknown as PrismaClient;

  await updateDashboardEventState(prisma, {
    action: "read",
    eventId: "event-1",
    organizationId: "org-1",
    userId: "user-1",
  });

  // 新契约：read 不再写 IntelligenceEvent.status（隔离要求）。
  const eventUpdates = calls.filter((c) => c.method === "intelligenceEvent.update");
  assert(
    eventUpdates.length === 0,
    "read 已收藏事件时不应写 IntelligenceEvent.status（SPEC §5.5 个人状态隔离）。",
  );

  const userUpsert = readArgsByName(calls, "userItemState.upsert");
  const userUpdate = readRecord(userUpsert.update, "userItemState.upsert.update");
  const feedbackData = readRecord(
    readArgsByName(calls, "feedbackEvent.create").data,
    "feedbackEvent.create.data",
  );

  assert(userUpdate.status === "SAVED", "Reading a saved event must keep user status SAVED.");
  assert(userUpdate.saved === true, "Reading a saved event must not clear the saved flag.");
  assert(userUpdate.readAt instanceof Date, "Reading a saved event must still record readAt.");
  assert(feedbackData.kind === "READ", "Reading a saved event must still record READ feedback.");
}

// ─── Issue #173 — Briefing 批量已读 (Plan Task 3.2) ─────────────────────────────
// 这些 mock 测试锁定契约：
//   - 复用 #172 UserItemState 隔离，只写 UserItemState + FeedbackEvent(READ)，
//     不写 IntelligenceEvent.status。
//   - 批量 upsert（不是 N 次 findFirst + 单写循环）。
//   - 保留 saved（双轨，对齐 updateDashboardEventState）。
//   - 幂等：已是 READ/SAVED 的 skip，返回 changed/skipped。
//   - 用户/组织隔离。
// 真实 PG 两用户隔离由 user-item-state-pg.fixtures.ts 风格的 disposable fixture 承载（后置）。

type BriefingReadCall = { args: unknown; method: string };

function makeBriefingReadMockPrisma(opts: {
  events: Array<{ id: string; topicId: string; organizationId: string; primaryItemId: string | null }>;
  userStates: Array<{
    userId: string;
    eventId: string;
    status: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
    saved: boolean;
    readAt: Date | null;
  }>;
  briefingOrganizationId?: string;
}): {
  prisma: unknown;
  calls: BriefingReadCall[];
} {
  const calls: BriefingReadCall[] = [];
  const eventsById = new Map(opts.events.map((e) => [e.id, e]));
  const statesByKey = new Map(
    opts.userStates.map((s) => [`${s.userId}:${s.eventId}`, s]),
  );

  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    briefing: {
      findFirst: async (args: unknown) => {
        calls.push({ args, method: "briefing.findFirst" });
        const a = args as { where?: { id?: string; organizationId?: string } };
        const id = a.where?.id;
        const orgId = a.where?.organizationId;
        const matchesOrg =
          orgId === undefined || orgId === (opts.briefingOrganizationId ?? "org-1");
        // mock: briefing snapshot.events 固定为 opts.events 的 ids 集合。
        return id === "briefing-1" && matchesOrg
          ? {
              id: "briefing-1",
              organizationId: opts.briefingOrganizationId ?? "org-1",
              events: opts.events.map((e) => ({ id: e.id })),
            }
          : null;
      },
    },
    userItemState: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "userItemState.findMany" });
        const a = args as {
          where?: { userId?: string; eventId?: { in?: string[] } };
        };
        const userId = a.where?.userId;
        const eventIds = a.where?.eventId?.in ?? [];
        return [...statesByKey.values()].filter(
          (s) => s.userId === userId && eventIds.includes(s.eventId),
        );
      },
      upsert: async (args: unknown) => {
        calls.push({ args, method: "userItemState.upsert" });
        return {};
      },
      createMany: async (args: unknown) => {
        calls.push({ args, method: "userItemState.createMany" });
        return { count: 0 };
      },
      updateMany: async (args: unknown) => {
        calls.push({ args, method: "userItemState.updateMany" });
        return { count: 0 };
      },
    },
    feedbackEvent: {
      create: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.create" });
        return {};
      },
      createMany: async (args: unknown) => {
        calls.push({ args, method: "feedbackEvent.createMany" });
        return { count: 0 };
      },
    },
    intelligenceEvent: {
      update: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.update" });
        return {};
      },
      findFirst: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.findFirst" });
        const a = args as { where?: { id?: string } };
        return eventsById.get(a.where?.id ?? "") ?? null;
      },
    },
  };
  return { prisma, calls };
}

async function verifyMarkBriefingEventsReadBatchesUserItemState(): Promise<void> {
  // 基本契约：briefing 含 3 个事件，用户无任何 UserItemState。
  // 期望：changed=3, skipped=0，对每个事件 upsert UserItemState(status=READ)。
  const { prisma, calls } = makeBriefingReadMockPrisma({
    events: [
      { id: "event-a", organizationId: "org-1", primaryItemId: "item-a", topicId: "topic-1" },
      { id: "event-b", organizationId: "org-1", primaryItemId: "item-b", topicId: "topic-1" },
      { id: "event-c", organizationId: "org-1", primaryItemId: "item-c", topicId: "topic-1" },
    ],
    userStates: [],
  });

  const result = await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-1",
    userId: "user-1",
  });

  assert(result.changed === 3, `Expected changed=3, received changed=${result.changed}.`);
  assert(result.skipped === 0, `Expected skipped=0, received skipped=${result.skipped}.`);

  const upserts = calls.filter((c) => c.method === "userItemState.upsert");
  assert(
    upserts.length === 3,
    `Expected 3 userItemState.upsert calls, received ${upserts.length}.`,
  );
  for (const call of upserts) {
    const args = readRecord(call.args, "userItemState.upsert.args");
    const update = readRecord(args.update, "userItemState.upsert.args.update");
    assert(
      update.status === "READ",
      `Each upsert must set status=READ, received ${String(update.status)}.`,
    );
    assert(
      update.readAt instanceof Date,
      "Each upsert must record a readAt timestamp.",
    );
    assert(
      update.saved === false,
      `Default (unsaved) events must keep saved=false, received ${String(update.saved)}.`,
    );
  }

  // 必须 create FeedbackEvent(READ) for each changed event（轻量正反馈，对齐单条 read 路径）。
  const feedbackCreates = calls.filter((c) => c.method === "feedbackEvent.create");
  assert(
    feedbackCreates.length === 3,
    `Expected 3 feedbackEvent.create (READ) calls, received ${feedbackCreates.length}.`,
  );

  // 不得写 IntelligenceEvent.status（隔离要求，对齐 #172）。
  const eventUpdates = calls.filter((c) => c.method === "intelligenceEvent.update");
  assert(
    eventUpdates.length === 0,
    "SPEC §5.5 违规：批量已读不得写 IntelligenceEvent.status（个人状态隔离）。",
  );
}

async function verifyMarkBriefingEventsReadIsIdempotentAndReportsSkipped(): Promise<void> {
  // 3 个事件，其中 2 个已是 READ/SAVED（应 skip），1 个 UNREAD（应 changed）。
  const alreadyReadAt = new Date("2026-07-18T08:00:00.000Z");
  const { prisma, calls } = makeBriefingReadMockPrisma({
    events: [
      { id: "event-a", organizationId: "org-1", primaryItemId: "item-a", topicId: "topic-1" },
      { id: "event-b", organizationId: "org-1", primaryItemId: "item-b", topicId: "topic-1" },
      { id: "event-c", organizationId: "org-1", primaryItemId: "item-c", topicId: "topic-1" },
    ],
    userStates: [
      { userId: "user-1", eventId: "event-a", status: "READ", saved: false, readAt: alreadyReadAt },
      { userId: "user-1", eventId: "event-b", status: "SAVED", saved: true, readAt: alreadyReadAt },
    ],
  });

  const result = await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-1",
    userId: "user-1",
  });

  assert(result.changed === 1, `Expected changed=1, received changed=${result.changed}.`);
  assert(result.skipped === 2, `Expected skipped=2, received skipped=${result.skipped}.`);

  const upserts = calls.filter((c) => c.method === "userItemState.upsert");
  assert(
    upserts.length === 1,
    `Idempotent run must only upsert the changed event, received ${upserts.length} upserts.`,
  );
  // 只为 changed 事件 create feedback（避免对已读事件重复产生 READ 反馈信号，污染偏好学习）。
  const feedbackCreates = calls.filter((c) => c.method === "feedbackEvent.create");
  assert(
    feedbackCreates.length === 1,
    `Idempotent run must only create 1 READ feedback, received ${feedbackCreates.length}.`,
  );
}

async function verifyMarkBriefingEventsReadPreservesSavedEvents(): Promise<void> {
  // SPEC §5.5 双轨：对已收藏事件执行 READ 保留 saved=true，status 保持 SAVED。
  const { prisma, calls } = makeBriefingReadMockPrisma({
    events: [
      { id: "event-saved", organizationId: "org-1", primaryItemId: "item-s", topicId: "topic-1" },
      { id: "event-fresh", organizationId: "org-1", primaryItemId: "item-f", topicId: "topic-1" },
    ],
    userStates: [
      { userId: "user-1", eventId: "event-saved", status: "SAVED", saved: true, readAt: null },
    ],
  });

  const result = await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-1",
    userId: "user-1",
  });

  // event-saved 已是 SAVED（属于"已读状态"的等价终态，对齐 updateDashboardEventState 双轨）→ skip。
  // event-fresh 是 UNREAD → changed。
  assert(result.changed === 1, `Expected changed=1, received changed=${result.changed}.`);
  assert(result.skipped === 1, `Expected skipped=1, received skipped=${result.skipped}.`);

  const upsert = calls.find((c) => c.method === "userItemState.upsert");
  assert(upsert, "Expected at least one userItemState.upsert call.");
  const args = readRecord(upsert!.args, "userItemState.upsert.args");
  const create = readRecord(args.create, "userItemState.upsert.args.create");
  assert(
    create.eventId === "event-fresh",
    `Fresh event must be the one upserted, received ${String(create.eventId)}.`,
  );
  assert(
    create.saved === false,
    `Fresh (unsaved) event must keep saved=false, received ${String(create.saved)}.`,
  );
}

async function verifyMarkBriefingEventsReadDoesNotLeakAcrossUsers(): Promise<void> {
  // 用户 A 对自己的 UserItemState 批量已读，不得影响用户 B 的状态。
  // mock 中用户 B 有一个 saved state——必须不被触碰。
  const { prisma, calls } = makeBriefingReadMockPrisma({
    events: [
      { id: "event-a", organizationId: "org-1", primaryItemId: "item-a", topicId: "topic-1" },
    ],
    userStates: [
      { userId: "user-B", eventId: "event-a", status: "SAVED", saved: true, readAt: null },
    ],
  });

  const result = await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-1",
    userId: "user-A",
  });

  assert(result.changed === 1, `Expected changed=1, received changed=${result.changed}.`);

  const findArgs = readArgsByName(calls, "userItemState.findMany");
  const where = readRecord(findArgs.where, "userItemState.findMany.where");
  assert(
    where.userId === "user-A",
    `User isolation: findMany must scope by current userId, received ${String(where.userId)}.`,
  );

  const upsert = calls.find((c) => c.method === "userItemState.upsert");
  const args = readRecord(upsert!.args, "userItemState.upsert.args");
  const where2 = readRecord(args.where, "userItemState.upsert.args.where");
  const key = readRecord(where2.userId_eventId, "userItemState.upsert.args.where.userId_eventId");
  assert(
    key.userId === "user-A",
    `User isolation: upsert where must be scoped by current userId, received ${String(key.userId)}.`,
  );
}

async function verifyMarkBriefingEventsReadIsOrganizationScoped(): Promise<void> {
  // briefing 查询必须 organization fenced：跨组织 briefingId 不得被命中。
  const { prisma } = makeBriefingReadMockPrisma({
    briefingOrganizationId: "org-1",
    events: [
      { id: "event-a", organizationId: "org-1", primaryItemId: "item-a", topicId: "topic-1" },
    ],
    userStates: [],
  });

  // 用 org-2 调用：mock briefing 只在 orgId 匹配 org-1 时返回非空。
  const result = await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-2",
    userId: "user-1",
  });

  assert(
    result.changed === 0 && result.skipped === 0,
    `Cross-org briefing must yield no changes, received changed=${result.changed} skipped=${result.skipped}.`,
  );
}

async function verifyMarkBriefingEventsReadNoNPlusOne(): Promise<void> {
  // 不产生 N+1：不得对每个 event 单独 findFirst + 单写。
  // 允许的形状：1 次 briefing.findFirst + 1 次 userItemState.findMany（批量）+ N 次 upsert（单事务内）。
  // 关键反模式：N 次 intelligenceEvent.findFirst、N 次 userItemState.findUnique。
  const { prisma, calls } = makeBriefingReadMockPrisma({
    events: Array.from({ length: 5 }, (_, i) => ({
      id: `event-${i}`,
      organizationId: "org-1",
      primaryItemId: `item-${i}`,
      topicId: "topic-1",
    })),
    userStates: [],
  });

  await markBriefingEventsRead(prisma as PrismaClient, {
    briefingId: "briefing-1",
    organizationId: "org-1",
    userId: "user-1",
  });

  const briefingFindFirst = calls.filter((c) => c.method === "briefing.findFirst");
  assert(
    briefingFindFirst.length === 1,
    `No N+1: briefing.findFirst must be called exactly once, received ${briefingFindFirst.length}.`,
  );

  const eventFindFirst = calls.filter((c) => c.method === "intelligenceEvent.findFirst");
  assert(
    eventFindFirst.length === 0,
    `No N+1: must not call intelligenceEvent.findFirst per event (received ${eventFindFirst.length}). Use a single userItemState.findMany to load existing states.`,
  );

  const stateFindMany = calls.filter((c) => c.method === "userItemState.findMany");
  assert(
    stateFindMany.length === 1,
    `No N+1: userItemState.findMany must be called exactly once (batched), received ${stateFindMany.length}.`,
  );
  const findArgs = readArgsByName(calls, "userItemState.findMany");
  const where = readRecord(findArgs.where, "userItemState.findMany.where");
  const eventId = readRecord(where.eventId, "userItemState.findMany.where.eventId");
  assert(
    Array.isArray(eventId.in) && eventId.in.length === 5,
    `No N+1: findMany must use eventId.in [...] for all briefing events (received ${String(eventId.in)}).`,
  );
}

async function verifyDailyBriefingWindowFilter(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    intelligenceEvent: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.findMany" });
        return [];
      },
    },
  } as unknown as PrismaClient;
  const rangeStart = new Date("2026-07-11T00:00:00.000Z");
  const rangeEnd = new Date("2026-07-12T00:00:00.000Z");

  const events = await listEventsForDailyBriefing(prisma, {
    organizationId: "org-1",
    rangeEnd,
    rangeStart,
    topicId: "topic-1",
  });

  assert(events.length === 0, "The empty mocked briefing query should stay empty.");
  const args = readArgsByName(calls, "intelligenceEvent.findMany");
  const where = readRecord(args.where, "intelligenceEvent.findMany.where");
  const createdAt = readRecord(where.createdAt, "briefing.where.createdAt");
  const primaryItem = readRecord(where.primaryItem, "briefing.where.primaryItem");
  const source = readRecord(primaryItem.source, "briefing.where.primaryItem.source");

  assert(createdAt.gte === rangeStart, "Daily briefing query must include the UTC range start.");
  assert(createdAt.lt === rangeEnd, "Daily briefing query must exclude the next UTC day boundary.");

  // SPEC §5.5 (#172): 简报是组织级产物，不按个人阅读状态（READ/SAVED/DISMISSED）过滤候选。
  // 只排除组织级 ARCHIVED。旧实现用 status in [UNREAD,READ,SAVED] 全局过滤是隔离泄漏。
  const statusFilter = where.status as Record<string, unknown> | undefined;
  assert(statusFilter !== undefined, "Briefing query must fence out ARCHIVED events.");
  const notIn = Array.isArray(statusFilter.notIn) ? (statusFilter.notIn as string[]) : [];
  assert(
    notIn.includes("ARCHIVED"),
    "Briefing query must exclude organization-level ARCHIVED events.",
  );
  // 不得出现 in: [...] 把个人状态当全局用。
  assert(
    !statusFilter.in,
    "SPEC §5.5 违规：briefing 查询不得用全局 status in [...] 过滤个人阅读状态。",
  );
  assert(where.summaryStatus === "READY", "Only successfully summarized events may enter formal briefings.");
  assert(source.status === "ACTIVE", "Only active sources may enter formal briefings.");
}

async function verifyDailyBriefingUpsert(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    briefing: {
      upsert: async (args: unknown) => {
        calls.push({ args, method: "briefing.upsert" });
        return {};
      },
    },
  } as unknown as PrismaClient;
  const generatedAt = new Date("2026-07-11T12:00:00.000Z");
  const rangeStart = new Date("2026-07-11T00:00:00.000Z");
  const rangeEnd = new Date("2026-07-12T00:00:00.000Z");

  await createDailyBriefing(prisma, {
    content: "briefing",
    eventIds: ["event-1", "event-2"],
    generatedAt,
    markdown: "# briefing",
    organizationId: "org-1",
    rangeEnd,
    rangeStart,
    title: "Daily Briefing",
    topicId: "topic-1",
  });

  const args = readArgsByName(calls, "briefing.upsert");
  const where = readRecord(args.where, "briefing.upsert.where");
  const uniqueWindow = readRecord(
    where.topicId_period_rangeStart,
    "briefing.upsert.where.topicId_period_rangeStart",
  );
  const update = readRecord(args.update, "briefing.upsert.update");
  const updateEvents = readRecord(update.events, "briefing.upsert.update.events");
  const eventSet = updateEvents.set as Array<{ id: string }>;

  assert(uniqueWindow.topicId === "topic-1", "Briefing upsert must be topic-scoped.");
  assert(uniqueWindow.period === "DAILY", "Briefing upsert must be period-scoped.");
  assert(uniqueWindow.rangeStart === rangeStart, "Briefing upsert must use the UTC range start key.");
  assert(update.generatedAt === generatedAt, "Briefing refresh must update generatedAt.");
  assert(eventSet.length === 2, "Briefing refresh must replace its event relation set.");
}

async function verifyBriefingHistoryPagination(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    briefing: {
      count: async (args: unknown) => {
        calls.push({ args, method: "briefing.count" });
        return 41;
      },
      findMany: async (args: unknown) => {
        calls.push({ args, method: "briefing.findMany" });
        return [];
      },
    },
  } as unknown as PrismaClient;

  const result = await listBriefingsPage(
    prisma,
    { organizationId: "org-1" },
    99,
    20,
  );

  assert(result.page === 3, `Expected briefing page 3, received ${result.page}.`);
  assert(result.pageCount === 3, `Expected 3 briefing pages, received ${result.pageCount}.`);
  assert(result.total === 41, `Expected 41 briefings, received ${result.total}.`);
  const findArgs = readArgsByName(calls, "briefing.findMany");
  assert(findArgs.skip === 40, `Expected briefing offset 40, received ${String(findArgs.skip)}.`);
  assert(findArgs.take === 20, `Expected briefing page size 20, received ${String(findArgs.take)}.`);
}

async function verifyTaskRunLifecycle(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const prisma = {
    taskRun: {
      create: async (args: unknown) => {
        calls.push({ args, method: "taskRun.create" });
        return { id: "task-1" };
      },
      update: async (args: unknown) => {
        calls.push({ args, method: "taskRun.update" });
        return { id: "task-1" };
      },
    },
  } as unknown as PrismaClient;

  await createTaskRun(prisma, {
    input: { mode: "llm-with-fallback" },
    itemId: "item-1",
    organizationId: "org-1",
    topicId: "topic-1",
    type: "AI_RELEVANCE",
  });
  await completeTaskRun(prisma, "task-1", { outcome: "event-upserted" });

  // Legacy failTaskRun must NEVER persist raw Error.message, credential URLs,
  // or stack-like traces. Only the fixed low-cardinality class is allowed.
  const credentialError = new Error(
    "fetch failed: https://user:secretpass@provider.example.com/v1/chat\n"
      + "    at fetch (node:internal/process/task:1:1)\n"
      + "    at Object.<anonymous> (/app/worker/src/modules/fetch-cycle.ts:42:9)",
  );
  await failTaskRun(prisma, "task-1", credentialError);

  const createData = readRecord(
    readArgsByName(calls, "taskRun.create").data,
    "taskRun.create.data",
  );
  assert(createData.organizationId === "org-1", "TaskRun must remain tenant-scoped.");
  assert(createData.topicId === "topic-1", "TaskRun must retain its topic relation.");
  assert(createData.itemId === "item-1", "TaskRun must retain its item relation.");
  assert(createData.type === "AI_RELEVANCE", "TaskRun must persist its real stage type.");
  assert(createData.status === "RUNNING", "A newly started TaskRun must be RUNNING.");
  assert(createData.attempt === 1, "A one-shot task must start at attempt 1.");
  assert(createData.maxAttempts === 1, "A one-shot task must expose its retry cap.");
  assert(createData.startedAt instanceof Date, "A TaskRun must record its start time.");
  assert(
    createData.scheduledAt === createData.startedAt,
    "Immediate TaskRuns must use one stable scheduled/start timestamp.",
  );

  const updates = calls.filter((entry) => entry.method === "taskRun.update");
  assert(updates.length === 2, "TaskRun completion and failure must both update lifecycle state.");
  const completed = readRecord(readRecord(updates[0]?.args, "complete.args").data, "complete.data");
  const failed = readRecord(readRecord(updates[1]?.args, "fail.args").data, "fail.data");
  assert(completed.status === "SUCCEEDED", "Completion must persist SUCCEEDED.");
  assert(completed.finishedAt instanceof Date, "Completion must record finishedAt.");
  assert(failed.status === "FAILED", "Failure must persist FAILED.");
  assert(failed.errorMessage === "application_error", "Failure must persist a fixed low-cardinality error class.");
  // Raw Error.message, credential URLs, and stack-like traces must never leak.
  assert(typeof failed.errorMessage === "string", "errorMessage must be a string (the fixed class).");
  assert(!failed.errorMessage.includes("secretpass"), "errorMessage must not leak credential URLs.");
  assert(!failed.errorMessage.includes("at fetch"), "errorMessage must not leak stack-like traces.");
  assert(!failed.errorMessage.includes("fetch-cycle"), "errorMessage must not leak file paths.");
  assert(
    failed.errorMessage === "application_error" || failed.errorMessage === "timeout" || failed.errorMessage === "upstream" || failed.errorMessage === "configuration" || failed.errorMessage === "cancelled",
    "errorMessage must be one of the fixed low-cardinality allowlist values.",
  );
}

async function verifySourceGovernanceMetricsUseActiveEventLinks(): Promise<void> {
  const prisma = {
    source: {
      findMany: async () => [
        {
          consecutiveFailures: 0,
          discoveryChannel: null,
          id: "source-1",
          items: [
            {
              eventItems: [
                {
                  event: { id: "event-1", status: "UNREAD" },
                  role: "PRIMARY",
                },
              ],
              intelligenceEvents: [{ id: "event-1", status: "UNREAD" }],
              status: "ANALYZED",
            },
            {
              eventItems: [
                {
                  event: { id: "event-archived", status: "ARCHIVED" },
                  role: "PRIMARY",
                },
                {
                  event: { id: "event-1", status: "UNREAD" },
                  role: "SECONDARY",
                },
              ],
              intelligenceEvents: [
                { id: "event-archived", status: "ARCHIVED" },
              ],
              status: "ANALYZED",
            },
            {
              eventItems: [],
              intelligenceEvents: [],
              status: "FILTERED",
            },
          ],
          lastError: null,
          lastErrorAt: null,
          lastFetchedAt: null,
          name: "Source One",
          qualityScore: 0,
          recommendationReason: null,
          sourceObservations: [],
          status: "ACTIVE",
          topic: { name: "Topic One" },
          topicId: "topic-1",
          trustScore: 0.5,
          url: "https://example.com/feed.xml",
        },
      ],
    },
  } as unknown as PrismaClient;

  const [source] = await listSourceGovernanceReport(prisma, {
    organizationId: "org-1",
  });

  assert(source, "Expected one source governance result.");
  assert(source.totalItems === 3, `Expected 3 items, received ${source.totalItems}.`);
  assert(source.eventCount === 1, `Expected 1 active event, received ${source.eventCount}.`);
  assert(source.hitRate === 0.6667, `Expected hit rate 0.6667, received ${source.hitRate}.`);
  assert(source.noiseRate === 0.3333, `Expected noise rate 0.3333, received ${source.noiseRate}.`);
  assert(
    source.duplicateRate === 0.3333,
    `Expected duplicate rate 0.3333, received ${source.duplicateRate}.`,
  );
  assert(source.qualityScore === 36.67, `Expected score 36.67, received ${source.qualityScore}.`);
}

/**
 * RED → GREEN: recordSourceQualityObservation 必须把 qualityScore 持久化到
 * Source 表（不只是写 SourceObservation），且 evidence 含 formulaVersion。
 */
async function verifySourceQualityScoreIsPersistedToSource(): Promise<void> {
  const updates: Array<{ data: { qualityScore: number }; where: { id: string } }> = [];
  const observations: Array<{ data: { evidence: unknown; sourceId: string } }> = [];

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        sourceObservation: {
          create: async (args: { data: { evidence: unknown; sourceId: string } }) => {
            observations.push(args);
            return { id: "obs-1" };
          },
        },
        source: {
          update: async (args: { data: { qualityScore: number }; where: { id: string } }) => {
            updates.push(args);
            return { id: args.where.id, qualityScore: args.data.qualityScore, status: "ACTIVE", trustScore: 0.6 };
          },
        },
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await recordSourceQualityObservation(prisma, {
    organizationId: "org-1",
    topicId: "topic-1",
    sourceId: "source-1",
    hitRate: 0.5,
    noiseRate: 0.4,
    duplicateRate: 0.1,
    trustScore: 0.6,
    evidence: { note: "test" },
  });

  // 持久化值 = 0.5*70 + 0.6*10 - 0.4*30 - 0.1*15 = 35 + 6 - 12 - 1.5 = 27.5
  assert(
    result.persistedQualityScore === 27.5,
    `Expected persistedQualityScore 27.5, received ${result.persistedQualityScore}.`,
  );
  assert(updates.length === 1, `Expected 1 source.update, received ${updates.length}.`);
  assert(
    updates[0]?.data.qualityScore === 27.5,
    `Expected Source.qualityScore updated to 27.5, received ${updates[0]?.data.qualityScore}.`,
  );
  assert(
    updates[0]?.where.id === "source-1",
    `Expected update on source-1, received ${updates[0]?.where.id}.`,
  );
  assert(observations.length === 1, `Expected 1 observation, received ${observations.length}.`);
  const evidence = observations[0]?.data.evidence as Record<string, unknown> | undefined;
  assert(evidence !== undefined, "Expected evidence on observation.");
  assert(
    typeof evidence?.formulaVersion === "string",
    `Expected evidence.formulaVersion to be string, received ${typeof evidence?.formulaVersion}.`,
  );
  assert(
    evidence?.source === "source-quality-report",
    `Expected evidence.source 'source-quality-report', received ${evidence?.source}.`,
  );
}

/**
 * 最小样本保护：totalItems < 8 时即使 recommendation=MUTE 也不自动降权。
 */
async function verifyAutomaticGovernanceDoesNotMuteSmallSample(): Promise<void> {
  const updates: Array<{ data: { status: string }; where: { id: string } }> = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        source: {
          update: async (args: { data: { status: string }; where: { id: string } }) => {
            updates.push(args);
            return {};
          },
        },
        sourceObservation: { create: async () => ({}) },
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await applyAutomaticSourceGovernance(prisma, {
    organizationId: "org-1",
    sources: [
      {
        sourceId: "source-small",
        status: "ACTIVE",
        recommendation: "MUTE",
        topicId: "topic-1",
        totalItems: 3,
      },
    ],
  });

  assert(
    result.autoMuted.length === 0,
    `Expected 0 auto-muted (small sample), received ${result.autoMuted.length}.`,
  );
  assert(updates.length === 0, `Expected 0 source.update (small sample), received ${updates.length}.`);
}

/**
 * 足够样本 + 低质 + MUTE 建议 → 自动降到 MUTED，写审计 observation。
 */
async function verifyAutomaticGovernanceMutesLowQualityLargeSample(): Promise<void> {
  const updates: Array<{ data: { status: string }; where: { id: string } }> = [];
  const observations: Array<{ data: { evidence: unknown; sourceId: string } }> = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        source: {
          update: async (args: { data: { status: string }; where: { id: string } }) => {
            updates.push(args);
            return {};
          },
        },
        sourceObservation: {
          create: async (args: { data: { evidence: unknown; sourceId: string } }) => {
            observations.push(args);
            return {};
          },
        },
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await applyAutomaticSourceGovernance(prisma, {
    organizationId: "org-1",
    sources: [
      {
        sourceId: "source-noisy",
        status: "ACTIVE",
        recommendation: "MUTE",
        topicId: "topic-1",
        totalItems: 20,
      },
    ],
  });

  assert(
    result.autoMuted.length === 1,
    `Expected 1 auto-muted, received ${result.autoMuted.length}.`,
  );
  assert(result.autoMuted[0] === "source-noisy", `Expected source-noisy muted.`);
  assert(updates.length === 1, `Expected 1 source.update, received ${updates.length}.`);
  assert(
    updates[0]?.data.status === "MUTED",
    `Expected status MUTED, received ${updates[0]?.data.status}.`,
  );
  assert(observations.length === 1, `Expected 1 audit observation, received ${observations.length}.`);
  const evidence = observations[0]?.data.evidence as Record<string, unknown> | undefined;
  assert(
    evidence?.source === "source-governance-auto",
    `Expected audit observation source 'source-governance-auto', received ${evidence?.source}.`,
  );
  assert(
    evidence?.reason === "auto-muted-low-quality",
    `Expected reason 'auto-muted-low-quality', received ${evidence?.reason}.`,
  );
}

/**
 * REJECT 建议保留人工确认：即使大样本也不自动落到 REJECTED。
 */
async function verifyAutomaticGovernanceDoesNotAutoReject(): Promise<void> {
  const updates: Array<{ data: { status: string }; where: { id: string } }> = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        source: {
          update: async (args: { data: { status: string }; where: { id: string } }) => {
            updates.push(args);
            return {};
          },
        },
        sourceObservation: { create: async () => ({}) },
      };
      return fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await applyAutomaticSourceGovernance(prisma, {
    organizationId: "org-1",
    sources: [
      {
        sourceId: "source-bad",
        status: "ACTIVE",
        recommendation: "REJECT",
        topicId: "topic-1",
        totalItems: 50,
      },
      // REJECTED 状态受保护，即使 MUTE 也不动。
      {
        sourceId: "source-rejected",
        status: "REJECTED",
        recommendation: "MUTE",
        topicId: "topic-1",
        totalItems: 50,
      },
    ],
  });

  assert(
    result.autoMuted.length === 0,
    `Expected 0 auto-muted (REJECT preserves human confirm), received ${result.autoMuted.length}.`,
  );
  assert(updates.length === 0, `Expected 0 source.update, received ${updates.length}.`);
}

/**
 * 报告同时暴露 persistedQualityScore / derivedQualityScore / stale，
 * 让 UI 和运维看出持久化值是否落后于真实指标。
 */
async function verifyGovernanceReportExposesPersistedAndDerivedQualityScore(): Promise<void> {
  const prisma = {
    source: {
      findMany: async () => [
        {
          // 已持久化的源：persisted=40, derived=36.67 → qualityScore=40, stale=false
          consecutiveFailures: 0,
          discoveryChannel: null,
          id: "source-persisted",
          items: [
            {
              eventItems: [{ event: { id: "e1", status: "UNREAD" }, role: "PRIMARY" }],
              intelligenceEvents: [{ id: "e1", status: "UNREAD" }],
              status: "ANALYZED",
            },
            { eventItems: [], intelligenceEvents: [], status: "FILTERED" },
            { eventItems: [], intelligenceEvents: [], status: "FILTERED" },
          ],
          lastError: null,
          lastErrorAt: null,
          lastFetchedAt: null,
          name: "Persisted",
          qualityScore: 40,
          recommendationReason: null,
          sourceObservations: [],
          status: "ACTIVE",
          topic: { name: "T" },
          topicId: "topic-1",
          trustScore: 0.5,
          url: "https://a.example.com/feed.xml",
        },
        {
          // 从未持久化的源：persisted=0 → stale=true, qualityScore 回退到 derived
          consecutiveFailures: 0,
          discoveryChannel: null,
          id: "source-stale",
          items: [
            {
              eventItems: [{ event: { id: "e1", status: "UNREAD" }, role: "PRIMARY" }],
              intelligenceEvents: [{ id: "e1", status: "UNREAD" }],
              status: "ANALYZED",
            },
            { eventItems: [], intelligenceEvents: [], status: "FILTERED" },
            { eventItems: [], intelligenceEvents: [], status: "FILTERED" },
          ],
          lastError: null,
          lastErrorAt: null,
          lastFetchedAt: null,
          name: "Stale",
          qualityScore: 0,
          recommendationReason: null,
          sourceObservations: [],
          status: "ACTIVE",
          topic: { name: "T" },
          topicId: "topic-1",
          trustScore: 0.5,
          url: "https://b.example.com/feed.xml",
        },
      ],
    },
  } as unknown as PrismaClient;

  const report = await listSourceGovernanceReport(prisma, { organizationId: "org-1" });
  assert(report.length === 2, `Expected 2 sources, received ${report.length}.`);

  const persisted = report.find((s) => s.sourceId === "source-persisted");
  const stale = report.find((s) => s.sourceId === "source-stale");
  assert(persisted, "Expected source-persisted in report.");
  assert(stale, "Expected source-stale in report.");

  // persisted=40 优先，不被 derived 覆盖。
  assert(
    persisted!.persistedQualityScore === 40,
    `Expected persistedQualityScore 40, received ${persisted!.persistedQualityScore}.`,
  );
  assert(
    persisted!.qualityScore === 40,
    `Expected qualityScore 40 (persisted), received ${persisted!.qualityScore}.`,
  );
  assert(
    persisted!.stale === false,
    `Expected stale false for persisted source, received ${persisted!.stale}.`,
  );
  assert(
    typeof persisted!.derivedQualityScore === "number",
    `Expected derivedQualityScore number, received ${typeof persisted!.derivedQualityScore}.`,
  );

  // stale 源：persisted=0, qualityScore 回退到 derived。
  assert(
    stale!.persistedQualityScore === 0,
    `Expected persistedQualityScore 0, received ${stale!.persistedQualityScore}.`,
  );
  assert(
    stale!.stale === true,
    `Expected stale true, received ${stale!.stale}.`,
  );
  assert(
    stale!.qualityScore === stale!.derivedQualityScore,
    `Expected qualityScore fallback to derived, received qualityScore=${stale!.qualityScore} derived=${stale!.derivedQualityScore}.`,
  );
}

/**
 * 统一读取接口：getSourceQualitySummary 读 Source 持久化值 + 最新 observation。
 */
async function verifyGetSourceQualitySummaryReadsPersistedValue(): Promise<void> {
  const prisma = {
    source: {
      findFirst: async () => ({
        id: "source-1",
        qualityScore: 42,
        trustScore: 0.7,
        status: "ACTIVE",
      }),
    },
    sourceObservation: {
      findFirst: async () => ({
        hitRate: 0.6,
        noiseRate: 0.2,
        duplicateRate: 0.1,
        observedAt: new Date("2026-07-18T00:00:00.000Z"),
      }),
    },
  } as unknown as PrismaClient;

  const summary = await getSourceQualitySummary(prisma, {
    organizationId: "org-1",
    sourceId: "source-1",
  });

  assert(summary, "Expected summary not null.");
  assert(
    summary!.qualityScore === 42,
    `Expected qualityScore 42 (persisted), received ${summary!.qualityScore}.`,
  );
  assert(
    summary!.trustScore === 0.7,
    `Expected trustScore 0.7, received ${summary!.trustScore}.`,
  );
  assert(
    summary!.latestHitRate === 0.6,
    `Expected latestHitRate 0.6, received ${summary!.latestHitRate}.`,
  );
  assert(
    summary!.stale === false,
    `Expected stale false (qualityScore=42), received ${summary!.stale}.`,
  );

  // 不存在的源返回 null。
  const prismaEmpty = {
    source: { findFirst: async () => null },
    sourceObservation: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const missing = await getSourceQualitySummary(prismaEmpty, {
    organizationId: "org-1",
    sourceId: "nope",
  });
  assert(missing === null, `Expected null for missing source, received ${JSON.stringify(missing)}.`);
}

async function verifyFuzzyEventMatchUpdatesExistingEvent(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const transaction = {
    eventItem: {
      updateMany: async (args: unknown) => {
        calls.push({ args, method: "eventItem.updateMany" });
        return { count: 1 };
      },
      upsert: async (args: unknown) => {
        calls.push({ args, method: "eventItem.upsert" });
        return {};
      },
    },
    intelligenceEvent: {
      create: async () => {
        throw new Error("Fuzzy matches must not create a second event.");
      },
      update: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.update" });
        return { id: "event-existing" };
      },
    },
    item: {
      update: async (args: unknown) => {
        calls.push({ args, method: "item.update" });
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    intelligenceEvent: {
      findFirst: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.findFirst" });
        return {
          id: "event-existing",
          primaryItemId: "item-old",
          status: "UNREAD",
        };
      },
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;

  await upsertIntelligenceEventFromItem(prisma, {
    category: "release",
    entities: ["OpenAI"],
    eventHash: "new-event-hash",
    explanation: "Relevant release",
    gravityScore: 80,
    occurredAt: new Date("2026-07-11T00:00:00.000Z"),
    organizationId: "org-1",
    primaryItemId: "item-new",
    score: 80,
    summary: "Summary",
    title: "Shared normalized title",
    titleHash: "shared-title-hash",
    topicId: "topic-1",
  });

  const eventUpdate = readArgsByName(calls, "intelligenceEvent.update");
  const fuzzyFind = readArgsByName(calls, "intelligenceEvent.findFirst");
  const fuzzyWhere = readRecord(fuzzyFind.where, "fuzzy.findFirst.where");
  const fuzzyStatus = readRecord(fuzzyWhere.status, "fuzzy.findFirst.where.status");
  assert(
    fuzzyStatus.not === "ARCHIVED",
    "Fuzzy matching must not attach new reports to archived events.",
  );
  const eventWhere = readRecord(eventUpdate.where, "event.update.where");
  const eventData = readRecord(eventUpdate.data, "event.update.data");
  assert(eventWhere.id === "event-existing", "Fuzzy match must update the existing event id.");
  assert(eventData.eventHash === "new-event-hash", "Updated event must use the new primary hash.");
  assert(eventData.primaryItemId === "item-new", "New report must become the primary item.");

  const roleUpdate = readArgsByName(calls, "eventItem.updateMany");
  const roleData = readRecord(roleUpdate.data, "eventItem.updateMany.data");
  assert(roleData.role === "SECONDARY", "Previous primary relation must become secondary.");
  const primaryUpsert = readArgsByName(calls, "eventItem.upsert");
  const primaryCreate = readRecord(primaryUpsert.create, "eventItem.upsert.create");
  assert(primaryCreate.itemId === "item-new", "New primary relation must reference the new item.");
  assert(primaryCreate.role === "PRIMARY", "New item relation must be primary.");

  const itemUpdates = calls.filter((entry) => entry.method === "item.update");
  assert(itemUpdates.length === 2, "Old and new item statuses must both be updated.");
  const oldItem = readRecord(itemUpdates[0]?.args, "oldItem.args");
  const newItem = readRecord(itemUpdates[1]?.args, "newItem.args");
  assert(readRecord(oldItem.where, "oldItem.where").id === "item-old", "Old item must be updated.");
  assert(
    readRecord(oldItem.data, "oldItem.data").status === "DUPLICATE",
    "Old primary item must become DUPLICATE.",
  );
  assert(readRecord(newItem.where, "newItem.where").id === "item-new", "New item must be updated.");
  assert(
    readRecord(newItem.data, "newItem.data").status === "ANALYZED",
    "New primary item must remain ANALYZED.",
  );
}

async function verifySemanticMergeClearsArchivedMatchKeys(): Promise<void> {
  const calls: Array<{ args: unknown; method: string }> = [];
  const transaction = {
    eventItem: {
      createMany: async (args: unknown) => {
        calls.push({ args, method: "eventItem.createMany" });
        return { count: 1 };
      },
    },
    intelligenceEvent: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.findMany" });
        return [{ eventItems: [], id: "event-merge", primaryItemId: "item-merge" }];
      },
      findFirst: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.findFirst" });
        return { eventItems: [], id: "event-keep", primaryItemId: "item-keep" };
      },
      updateMany: async (args: unknown) => {
        calls.push({ args, method: "intelligenceEvent.updateMany" });
        return { count: 1 };
      },
    },
    item: {
      updateMany: async (args: unknown) => {
        calls.push({ args, method: "item.updateMany" });
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as PrismaClient;

  await mergeSemanticEvents(prisma, {
    organizationId: "org-semantic",
    keepEventId: "event-keep",
    mergeEventIds: ["event-merge"],
    reason: "same real-world event",
  });

  const relation = readArgsByName(calls, "eventItem.createMany");
  const relationData = relation.data as Array<Record<string, unknown>>;
  assert(Array.isArray(relationData) && relationData.length === 1, "Expected one merged relation.");
  assert(relationData[0]?.itemId === "item-merge", "Merged primary item must move to keep event.");
  assert(relationData[0]?.role === "SECONDARY", "Merged item must become a secondary report.");
  const itemUpdate = readArgsByName(calls, "item.updateMany");
  assert(
    readRecord(itemUpdate.where, "semantic.item.where").organizationId === "org-semantic",
    "Semantic duplicate item updates must be organization fenced.",
  );
  assert(
    readRecord(itemUpdate.data, "semantic.item.data").status === "DUPLICATE",
    "Merged items must become DUPLICATE.",
  );
  const archived = readRecord(
    readArgsByName(calls, "intelligenceEvent.updateMany").data,
    "semantic.event.data",
  );
  assert(archived.status === "ARCHIVED", "Merged event must be archived.");
  assert(archived.eventHash === null, "Archived merged event must release eventHash.");
  assert(archived.titleHash === null, "Archived merged event must stop fuzzy matching.");
  const keepWhere = readRecord(
    readArgsByName(calls, "intelligenceEvent.findFirst").where,
    "semantic.keep.where",
  );
  const mergeWhere = readRecord(
    readArgsByName(calls, "intelligenceEvent.findMany").where,
    "semantic.merge.where",
  );
  const archiveWhere = readRecord(
    readArgsByName(calls, "intelligenceEvent.updateMany").where,
    "semantic.archive.where",
  );
  assert(keepWhere.organizationId === "org-semantic", "Keep event lookup must be organization fenced.");
  assert(mergeWhere.organizationId === "org-semantic", "Merge event lookup must be organization fenced.");
  assert(archiveWhere.organizationId === "org-semantic", "Archive update must be organization fenced.");
}

function readArgs(
  calls: Array<{ args: unknown; method: "count" | "findMany" }>,
  method: "count" | "findMany",
): Record<string, unknown> {
  const call = calls.find((entry) => entry.method === method);
  assert(call, `Expected ${method} to be called.`);
  return readRecord(call.args, `${method}.args`);
}

function readArgsByName(
  calls: Array<{ args: unknown; method: string }>,
  method: string,
): Record<string, unknown> {
  const call = calls.find((entry) => entry.method === method);
  assert(call, `Expected ${method} to be called.`);
  return readRecord(call.args, `${method}.args`);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Run a synchronous function and return the thrown Error, or null if it
 * did not throw. Used by crypto tests that need to inspect error messages.
 */
function captureError(fn: () => unknown): Error | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

/**
 * Crypto credentials must round-trip with the random salt format.
 *
 * The 4-part format is `salt:iv:ciphertext:tag`.
 * Encryption must derive the key using the same random salt that is stored,
 * otherwise decryption with the stored salt produces a different key and
 * AES-GCM auth tag verification fails.
 */
async function verifyCryptoRoundTrip(): Promise<void> {
  const testKey = "a".repeat(32);
  const testPlaintext = "wangchao-crypto-round-trip-plaintext";

  // Round-trip: encrypt then decrypt must return original plaintext.
  const encrypted = encryptCredential(testPlaintext, testKey);
  const decrypted = decryptCredential(encrypted, testKey);
  assert(
    decrypted === testPlaintext,
    "Crypto round-trip: decrypted text must match the original plaintext.",
  );

  // 4-part format: salt:iv:ciphertext:tag
  const parts = encrypted.split(":");
  assert(parts.length === 4, "Encrypted credential must use the 4-part salt:iv:ciphertext:tag format.");
}

/**
 * Encrypting the same plaintext twice must produce different ciphertexts,
 * because each encryption uses a fresh random salt and IV.
 */
async function verifyCryptoProducesDifferentCiphertexts(): Promise<void> {
  const testKey = "a".repeat(32);
  const testPlaintext = "wangchao-crypto-uniqueness-plaintext";

  const encrypted1 = encryptCredential(testPlaintext, testKey);
  const encrypted2 = encryptCredential(testPlaintext, testKey);
  assert(encrypted1 !== encrypted2, "Two encryptions of the same plaintext must produce different ciphertexts.");

  // Both must still decrypt back correctly.
  assert(decryptCredential(encrypted1, testKey) === testPlaintext, "First ciphertext must decrypt correctly.");
  assert(decryptCredential(encrypted2, testKey) === testPlaintext, "Second ciphertext must decrypt correctly.");
}

/**
 * Decrypting with the wrong key must fail (AES-GCM auth tag mismatch).
 */
async function verifyCryptoWrongKeyFails(): Promise<void> {
  const correctKey = "a".repeat(32);
  const wrongKey = "b".repeat(32);
  const testPlaintext = "wangchao-crypto-wrong-key-plaintext";

  const encrypted = encryptCredential(testPlaintext, correctKey);

  let threw = false;
  try {
    decryptCredential(encrypted, wrongKey);
  } catch {
    threw = true;
  }
  assert(threw, "Decrypting with a wrong key must throw an error.");
}

/**
 * Tampering with any of the salt, IV, ciphertext, or tag must fail decryption.
 */
async function verifyCryptoTamperDetection(): Promise<void> {
  const testKey = "a".repeat(32);
  const testPlaintext = "wangchao-crypto-tamper-plaintext";
  const encrypted = encryptCredential(testPlaintext, testKey);
  const parts = encrypted.split(":");

  // Tamper salt (part 0)
  {
    const tamperedSalt = Buffer.from(parts[0]!, "base64");
    tamperedSalt[0] = (tamperedSalt[0]! + 1) & 0xff;
    const tampered = [tamperedSalt.toString("base64"), parts[1]!, parts[2]!, parts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(tampered, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Tampering with the salt must cause decryption to fail.");
  }

  // Tamper ciphertext (part 2)
  {
    const tamperedCt = Buffer.from(parts[2]!, "base64");
    tamperedCt[0] = (tamperedCt[0]! + 1) & 0xff;
    const tampered = [parts[0]!, parts[1]!, tamperedCt.toString("base64"), parts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(tampered, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Tampering with the ciphertext must cause decryption to fail.");
  }

  // Tamper tag (part 3)
  {
    const tamperedTag = Buffer.from(parts[3]!, "base64");
    tamperedTag[0] = (tamperedTag[0]! + 1) & 0xff;
    const tampered = [parts[0]!, parts[1]!, parts[2]!, tamperedTag.toString("base64")].join(":");
    let threw = false;
    try {
      decryptCredential(tampered, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Tampering with the tag must cause decryption to fail.");
  }

  // Tamper IV (part 1)
  {
    const tamperedIv = Buffer.from(parts[1]!, "base64");
    tamperedIv[0] = (tamperedIv[0]! + 1) & 0xff;
    const tampered = [parts[0]!, tamperedIv.toString("base64"), parts[2]!, parts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(tampered, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Tampering with the IV must cause decryption to fail.");
  }
}

/**
 * The legacy 3-part format `iv:ciphertext:tag` (no salt, static salt used)
 * must still decrypt correctly for backward compatibility with existing data.
 */
async function verifyCryptoLegacyThreePartFormat(): Promise<void> {
  const testKey = "a".repeat(32);
  const testPlaintext = "wangchao-crypto-legacy-plaintext";

  // Manually construct a legacy 3-part ciphertext using the static salt.
  const STATIC_SALT = "wangchao-credential-salt-v1";
  const iv = randomBytes(12);
  const key = scryptSync(testKey, STATIC_SALT, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(testPlaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const legacyCiphertext = [iv.toString("base64"), encrypted.toString("base64"), tag.toString("base64")].join(":");

  // Legacy 3-part must decrypt correctly.
  const decrypted = decryptCredential(legacyCiphertext, testKey);
  assert(decrypted === testPlaintext, "Legacy 3-part format must decrypt correctly for backward compatibility.");

  // It must use exactly 3 parts.
  assert(legacyCiphertext.split(":").length === 3, "Legacy ciphertext must have exactly 3 parts.");
}

/**
 * Compatibility: a pre-fix bug produced 4-part ciphertext where the stored
 * random salt was NOT used for key derivation. The key was derived with the
 * STATIC_SALT instead. `decryptCredential` must recover these old records
 * by falling back to STATIC_SALT when AES-GCM auth fails with the stored salt.
 *
 * The fallback is ONLY for pre-fix 4-part ciphertext. New ciphertext must not
 * benefit from it; if the new salt is corrupted, both paths must fail.
 * No automatic migration occurs; old records upgrade only when re-saved.
 */
async function verifyCryptoLegacyBugFourPartFallback(): Promise<void> {
  const testKey = "a".repeat(32);
  const testPlaintext = "wangchao-crypto-legacy-bug-plaintext";

  // Construct a pre-fix 4-part ciphertext: random salt stored but key derived
  // with STATIC_SALT.
  // Deliberately NOT imported from crypto.ts — hardcoding the legacy salt
  // freezes the compatibility contract: if the production constant changes,
  // this test MUST fail, alerting us that old records can no longer be read.
  const LEGACY_STATIC_SALT = "wangchao-credential-salt-v1";
  const randomSalt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(testKey, LEGACY_STATIC_SALT, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(testPlaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const legacyBugCiphertext = [
    randomSalt.toString("base64"),
    iv.toString("base64"),
    encrypted.toString("base64"),
    tag.toString("base64"),
  ].join(":");

  assert(
    legacyBugCiphertext.split(":").length === 4,
    "Legacy bug ciphertext must have 4 parts.",
  );

  // Must decrypt successfully via the STATIC_SALT fallback.
  const decrypted = decryptCredential(legacyBugCiphertext, testKey);
  assert(
    decrypted === testPlaintext,
    "Pre-fix 4-part ciphertext (key derived with STATIC_SALT) must decrypt via fallback.",
  );

  // Wrong key must still fail even with the fallback.
  let threwWrongKey = false;
  try {
    decryptCredential(legacyBugCiphertext, "b".repeat(32));
  } catch {
    threwWrongKey = true;
  }
  assert(threwWrongKey, "Wrong key must fail even with the STATIC_SALT fallback.");
}

/**
 * Malformed payloads must be rejected with a clear error, not silently succeed.
 */
async function verifyCryptoMalformedPayloadRejected(): Promise<void> {
  const testKey = "a".repeat(32);

  // 2-part format is invalid
  {
    const malformed = "aaaa:bbbb";
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A 2-part payload must be rejected as malformed.");
  }

  // 5-part format is invalid
  {
    const malformed = "a:b:c:d:e";
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A 5-part payload must be rejected as malformed.");
  }

  // Empty string is invalid
  {
    let threw = false;
    try {
      decryptCredential("", testKey);
    } catch {
      threw = true;
    }
    assert(threw, "An empty payload must be rejected as malformed.");
  }
}

/**
 * Strict component validation: decoded salt, IV, tag must have exact lengths,
 * ciphertext must not be empty, and non-canonical base64 must be rejected.
 *
 * Node's Buffer.from(x, 'base64') is lenient - it silently ignores garbage
 * characters. We must use a strict base64 helper to reject such input rather
 * than relying on length checks that might happen to pass.
 */
async function verifyCryptoStrictComponentValidation(): Promise<void> {
  const testKey = "a".repeat(32);

  // Helper: build a valid 4-part ciphertext, then replace one component.
  const validEncrypted = encryptCredential("test-plaintext", testKey);
  const validParts = validEncrypted.split(":");

  // Short salt (15 bytes instead of 16)
  {
    const shortSalt = randomBytes(15).toString("base64");
    const malformed = [shortSalt, validParts[1]!, validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A short salt (15 bytes) must be rejected.");
  }

  // Short IV (11 bytes instead of 12)
  {
    const shortIv = randomBytes(11).toString("base64");
    const malformed = [validParts[0]!, shortIv, validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A short IV (11 bytes) must be rejected.");
  }

  // Short tag (15 bytes instead of 16)
  {
    const shortTag = randomBytes(15).toString("base64");
    const malformed = [validParts[0]!, validParts[1]!, validParts[2]!, shortTag].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A short tag (15 bytes) must be rejected.");
  }

  // Invalid base64 in salt (contains '!' which is not valid base64)
  {
    const invalidBase64 = "abcd!efghijklmnop==";
    const malformed = [invalidBase64, validParts[1]!, validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Invalid base64 in salt must be rejected, not silently decoded.");
  }

  // Empty ciphertext
  {
    const malformed = [validParts[0]!, validParts[1]!, "", validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "An empty ciphertext must be rejected.");
  }

  // Empty salt (0 bytes)
  {
    const malformed = ["", validParts[1]!, validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "An empty salt must be rejected.");
  }

  // Invalid base64 in 3-part format IV
  {
    const malformed = ["abcd!efghijkl==", validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "Invalid base64 in 3-part IV must be rejected.");
  }

  // Short IV in 3-part format (11 bytes)
  {
    const shortIv = randomBytes(11).toString("base64");
    const malformed = [shortIv, validParts[2]!, validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A short IV (11 bytes) in 3-part format must be rejected.");
  }

  // Short tag in 3-part format (15 bytes)
  {
    const shortTag = randomBytes(15).toString("base64");
    const malformed = [validParts[1]!, validParts[2]!, shortTag].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "A short tag (15 bytes) in 3-part format must be rejected.");
  }

  // Empty ciphertext in 3-part format
  {
    const malformed = [validParts[1]!, "", validParts[3]!].join(":");
    let threw = false;
    try {
      decryptCredential(malformed, testKey);
    } catch {
      threw = true;
    }
    assert(threw, "An empty ciphertext in 3-part format must be rejected.");
  }
}

/**
 * I2: Authentication failures must produce a stable, non-leaking error message.
 *
 * Wrong key, tampered ciphertext, and legacy bug ciphertext with wrong key must
 * all throw a fixed "Credential decryption failed" error — never leaking
 * Node/OpenSSL internal strings like "Unsupported state or unable to
 * authenticate data". This applies to both 4-part and 3-part formats.
 */
async function verifyCryptoAuthFailureProducesStableError(): Promise<void> {
  const correctKey = "a".repeat(32);
  const wrongKey = "b".repeat(32);
  const testPlaintext = "wangchao-crypto-stable-error-plaintext";
  const encrypted = encryptCredential(testPlaintext, correctKey);

  // Case 1: Wrong key on new 4-part ciphertext (stored salt auth fails,
  // STATIC_SALT fallback also fails → stable error).
  {
    const error = captureError(() => decryptCredential(encrypted, wrongKey));
    assert(error !== null, "Wrong key on 4-part must throw.");
    assert(
      error!.message === "Credential decryption failed",
      `Wrong key error must be "Credential decryption failed", got: ${error!.message}`,
    );
    assert(
      !error!.message.includes("Unsupported state"),
      "Error must not leak Node/OpenSSL internal strings.",
    );
  }

  // Case 2: Tampered ciphertext on new 4-part (correct key but bad ciphertext).
  {
    const parts = encrypted.split(":");
    const tamperedCt = Buffer.from(parts[2]!, "base64");
    tamperedCt[0] = (tamperedCt[0]! + 1) & 0xff;
    const tampered = [parts[0]!, parts[1]!, tamperedCt.toString("base64"), parts[3]!].join(":");
    const error = captureError(() => decryptCredential(tampered, correctKey));
    assert(error !== null, "Tampered ciphertext must throw.");
    assert(
      error!.message === "Credential decryption failed",
      `Tampered ciphertext error must be "Credential decryption failed", got: ${error!.message}`,
    );
    assert(
      !error!.message.includes("Unsupported state"),
      "Tampered ciphertext error must not leak Node/OpenSSL strings.",
    );
  }

  // Case 3: Legacy bug 4-part ciphertext with wrong key (stored salt auth
  // fails, STATIC_SALT auth also fails → stable error).
  {
    const LEGACY_STATIC_SALT = "wangchao-credential-salt-v1";
    const randomSalt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(correctKey, LEGACY_STATIC_SALT, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update("legacy-bug-wrong-key", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacyBugCt = [
      randomSalt.toString("base64"),
      iv.toString("base64"),
      enc.toString("base64"),
      tag.toString("base64"),
    ].join(":");

    const error = captureError(() => decryptCredential(legacyBugCt, wrongKey));
    assert(error !== null, "Legacy bug ciphertext with wrong key must throw.");
    assert(
      error!.message === "Credential decryption failed",
      `Legacy bug wrong key error must be "Credential decryption failed", got: ${error!.message}`,
    );
    assert(
      !error!.message.includes("Unsupported state"),
      "Legacy bug wrong key error must not leak Node/OpenSSL strings.",
    );
  }

  // Case 4: 3-part legacy format with wrong key.
  {
    const LEGACY_STATIC_SALT = "wangchao-credential-salt-v1";
    const iv = randomBytes(12);
    const key = scryptSync(correctKey, LEGACY_STATIC_SALT, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update("three-part-wrong-key", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const threePartCt = [iv.toString("base64"), enc.toString("base64"), tag.toString("base64")].join(":");

    const error = captureError(() => decryptCredential(threePartCt, wrongKey));
    assert(error !== null, "3-part format with wrong key must throw.");
    assert(
      error!.message === "Credential decryption failed",
      `3-part wrong key error must be "Credential decryption failed", got: ${error!.message}`,
    );
    assert(
      !error!.message.includes("Unsupported state"),
      "3-part wrong key error must not leak Node/OpenSSL strings.",
    );
  }
}

/**
 * I1: Format, length, and base64 errors must NOT be swallowed into
 * "Credential decryption failed". The narrow authenticated-decrypt helper
 * must only catch auth failures around `final()`, not deriveKey /
 * createDecipheriv / setAuthTag / update. Configuration and programming
 * errors must propagate with their original specific messages.
 */
async function verifyCryptoFormatErrorsNotSwallowedByAuthFallback(): Promise<void> {
  const testKey = "a".repeat(32);
  const validEncrypted = encryptCredential("test-plaintext", testKey);
  const validParts = validEncrypted.split(":");

  // Short salt (15 bytes) must still throw "Invalid salt length".
  {
    const shortSalt = randomBytes(15).toString("base64");
    const malformed = [shortSalt, validParts[1]!, validParts[2]!, validParts[3]!].join(":");
    const error = captureError(() => decryptCredential(malformed, testKey));
    assert(error !== null, "Short salt must throw.");
    assert(
      error!.message.includes("Invalid salt length"),
      `Short salt must produce "Invalid salt length" error, got: ${error!.message}`,
    );
    assert(
      error!.message !== "Credential decryption failed",
      "Short salt must NOT be swallowed into auth failure error.",
    );
  }

  // Invalid base64 must still throw "not canonical base64".
  {
    const invalidBase64 = "abcd!efghijklmnop==";
    const malformed = [invalidBase64, validParts[1]!, validParts[2]!, validParts[3]!].join(":");
    const error = captureError(() => decryptCredential(malformed, testKey));
    assert(error !== null, "Invalid base64 must throw.");
    assert(
      error!.message.includes("not canonical base64"),
      `Invalid base64 must produce canonical base64 error, got: ${error!.message}`,
    );
    assert(
      error!.message !== "Credential decryption failed",
      "Invalid base64 must NOT be swallowed into auth failure error.",
    );
  }

  // Short encryption key must still throw "Encryption key is too short".
  {
    const error = captureError(() => decryptCredential(validEncrypted, "short"));
    assert(error !== null, "Short key must throw.");
    assert(
      error!.message === "Encryption key is too short",
      `Short key must produce "Encryption key is too short", got: ${error!.message}`,
    );
    assert(
      !error!.message.includes("decryption failed"),
      "Short key must NOT be swallowed into auth failure error.",
    );
  }
}

/**
 * I3: Oversized encrypted payloads must be rejected immediately with a fixed
 * format error before any base64 decode or KDF operation.
 *
 * Plaintext is capped at 8192 bytes. Base64 expands by 4/3, plus three
 * metadata segments (salt 16B, iv 12B, tag 16B ≈ 60 bytes base64) and
 * delimiters. 8192 * 4/3 + 60 ≈ 10984 bytes. 16384 provides a conservative
 * ceiling well above any legitimate payload.
 */
async function verifyCryptoOversizedPayloadRejected(): Promise<void> {
  const testKey = "a".repeat(32);

  // Construct a valid-structure 4-part payload that exceeds MAX_ENCRYPTED_CREDENTIAL_LENGTH.
  const oversizedCiphertext = Buffer.alloc(16384).fill(0x41).toString("base64");
  const malformed = [
    randomBytes(16).toString("base64"),
    randomBytes(12).toString("base64"),
    oversizedCiphertext,
    randomBytes(16).toString("base64"),
  ].join(":");

  assert(
    malformed.length > 16384,
    "Test fixture must exceed the max encrypted credential length.",
  );

  const error = captureError(() => decryptCredential(malformed, testKey));
  assert(error !== null, "Oversized payload must throw.");
  assert(
    error!.message.includes("exceeds maximum") || error!.message.includes("too large"),
    `Oversized payload must produce a length-related error, got: ${error!.message}`,
  );
  // Must not fall through to format parsing error.
  assert(
    !error!.message.includes("expected salt:iv:ciphertext:tag"),
    "Oversized payload must be caught before format parsing.",
  );
  // Must not leak Node/OpenSSL auth strings (would mean KDF ran).
  assert(
    !error!.message.includes("Unsupported state"),
    "Oversized payload must not reach KDF/decryption.",
  );
}

/**
 * The cryptoSmokeTest() function must be exercised as part of the test suite,
 * not just left as a standalone utility that could silently stop running.
 */
async function verifyCryptoSmokeTestExecutes(): Promise<void> {
  // Also run the additional crypto verifications.
  await verifyCryptoProducesDifferentCiphertexts();
  await verifyCryptoWrongKeyFails();
  await verifyCryptoTamperDetection();
  await verifyCryptoLegacyThreePartFormat();
  await verifyCryptoLegacyBugFourPartFallback();
  await verifyCryptoMalformedPayloadRejected();
  await verifyCryptoStrictComponentValidation();
  await verifyCryptoAuthFailureProducesStableError();
  await verifyCryptoFormatErrorsNotSwallowedByAuthFallback();
  await verifyCryptoOversizedPayloadRejected();

  // cryptoSmokeTest must not throw.
  cryptoSmokeTest();
}

async function verifyRecommendCandidatePromotionContract(): Promise<void> {
  // 非 CANDIDATE 防御性返回 OBSERVE。
  assert(
    recommendCandidatePromotion({
      status: "ACTIVE",
      qualityScore: 80,
      trustScore: 0.9,
      totalItems: 50,
      hitRate: 0.5,
      noiseRate: 0.1,
      duplicateRate: 0.05,
      stale: false,
    }) === "OBSERVE",
    "Non-CANDIDATE sources must defensively return OBSERVE.",
  );

  // 抓取失败 + 零样本 → INSUFFICIENT_SAMPLE（不得误拒绝）。
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 0,
      trustScore: 0.5,
      totalItems: 0,
      hitRate: null,
      noiseRate: null,
      duplicateRate: null,
      stale: true,
      hasRecentFetchFailure: true,
    }) === "INSUFFICIENT_SAMPLE",
    "Fetch failure with zero samples must return INSUFFICIENT_SAMPLE, not REJECT.",
  );

  // 样本不足 → INSUFFICIENT_SAMPLE。
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 60,
      trustScore: 0.7,
      totalItems: SOURCE_QUALITY_MIN_SAMPLE - 1,
      hitRate: 0.3,
      noiseRate: 0.2,
      duplicateRate: 0.05,
      stale: false,
    }) === "INSUFFICIENT_SAMPLE",
    "Below-min-sample candidates must continue observation.",
  );

  // 高质量晋升。
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 55,
      trustScore: 0.8,
      totalItems: 30,
      hitRate: 0.3,
      noiseRate: 0.3,
      duplicateRate: 0.1,
      stale: false,
    }) === "APPROVE",
    "High-quality candidate with sufficient sample must be APPROVE.",
  );

  // 明确低质 → REJECT（仅建议，不自动执行）。
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 10,
      trustScore: 0.2,
      totalItems: 50,
      hitRate: 0.05,
      noiseRate: 0.8,
      duplicateRate: 0.1,
      stale: false,
    }) === "REJECT",
    "Extreme noise + low hit must suggest REJECT (recommendation only).",
  );

  // 中间地带 → MUTE。
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 20,
      trustScore: 0.5,
      totalItems: 40,
      hitRate: 0.15,
      noiseRate: 0.6,
      duplicateRate: 0.1,
      stale: false,
    }) === "MUTE",
    "Borderline noise/quality must suggest MUTE.",
  );
}

async function verifyComputeCandidateQualityMetricsAggregatesBySource(): Promise<void> {
  const metrics = computeCandidateQualityMetrics([
    { sourceId: "src-1", topicId: "topic-1", isRelevant: true, isNoise: false, isDuplicate: false },
    { sourceId: "src-1", topicId: "topic-1", isRelevant: false, isNoise: true, isDuplicate: false },
    { sourceId: "src-2", topicId: "topic-1", isRelevant: true, isNoise: false, isDuplicate: true },
  ]);

  const src1 = metrics.get("src-1");
  assert(src1 !== undefined, "src-1 must have metrics.");
  assert(src1!.totalItems === 2, `src-1 totalItems must be 2, got ${src1!.totalItems}.`);
  assert(src1!.hitItems === 1, `src-1 hitItems must be 1, got ${src1!.hitItems}.`);
  assert(src1!.filteredItems === 1, `src-1 filteredItems must be 1, got ${src1!.filteredItems}.`);
  assert(src1!.hitRate === 0.5, `src-1 hitRate must be 0.5, got ${src1!.hitRate}.`);
  assert(src1!.noiseRate === 0.5, `src-1 noiseRate must be 0.5, got ${src1!.noiseRate}.`);
  assert(src1!.duplicateRate === 0, `src-1 duplicateRate must be 0, got ${src1!.duplicateRate}.`);

  const src2 = metrics.get("src-2");
  assert(src2 !== undefined, "src-2 must have metrics.");
  assert(src2!.totalItems === 1, "src-2 totalItems must be 1.");
  assert(src2!.hitItems === 0, "src-2 relevant+duplicate must not count as hit.");
  assert(src2!.duplicateItems === 1, "src-2 duplicateItems must be 1.");
  assert(src2!.duplicateRate === 1, "src-2 duplicateRate must be 1.");
}
