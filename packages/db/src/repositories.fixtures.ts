import type { PrismaClient } from "@prisma/client";
import {
  completeTaskRun,
  createDailyBriefing,
  createTaskRun,
  failTaskRun,
  listBriefingsPage,
  listEventsForDailyBriefing,
  listFetchedItemsForAnalysis,
  listRecentFeedbackSignals,
  listSavedDashboardEvents,
  listSourceGovernanceReport,
  mergeSemanticEvents,
  recordCategoryPreferenceFeedback,
  updateDashboardEventState,
  updateTopic,
  upsertIntelligenceEventFromItem,
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
  await verifyReadPreservesSavedState();
  await verifyCategoryFeedbackIsPersistedAndLearned();
  await verifyTopicUpdateAndAnalysisContextStayTenantScoped();
  await verifyDailyBriefingWindowFilter();
  await verifyDailyBriefingUpsert();
  await verifyBriefingHistoryPagination();
  await verifyTaskRunLifecycle();
  await verifySourceGovernanceMetricsUseActiveEventLinks();
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
            event: {
              category: "AI",
              primaryItem: {
                source: { name: "Source One" },
                sourceId: "source-1",
              },
            },
            kind: "CATEGORY_UP",
            topicId: "topic-1",
            value: 2,
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

async function verifyReadPreservesSavedState(): Promise<void> {
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
        userStates: [{ readAt: null, saved: true }],
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

  const eventUpdate = readRecord(
    readArgsByName(calls, "intelligenceEvent.update").data,
    "intelligenceEvent.update.data",
  );
  const userUpsert = readArgsByName(calls, "userItemState.upsert");
  const userUpdate = readRecord(userUpsert.update, "userItemState.upsert.update");
  const feedbackData = readRecord(
    readArgsByName(calls, "feedbackEvent.create").data,
    "feedbackEvent.create.data",
  );

  assert(eventUpdate.status === "SAVED", "Reading a saved event must keep event status SAVED.");
  assert(userUpdate.status === "SAVED", "Reading a saved event must keep user status SAVED.");
  assert(userUpdate.saved === true, "Reading a saved event must not clear the saved flag.");
  assert(userUpdate.readAt instanceof Date, "Reading a saved event must still record readAt.");
  assert(feedbackData.kind === "READ", "Reading a saved event must still record READ feedback.");
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
  const status = readRecord(where.status, "briefing.where.status");
  const statuses = status.in as unknown[];
  const primaryItem = readRecord(where.primaryItem, "briefing.where.primaryItem");
  const source = readRecord(primaryItem.source, "briefing.where.primaryItem.source");

  assert(createdAt.gte === rangeStart, "Daily briefing query must include the UTC range start.");
  assert(createdAt.lt === rangeEnd, "Daily briefing query must exclude the next UTC day boundary.");
  assert(statuses.includes("READ"), "Read events from the same day must remain briefing candidates.");
  assert(!statuses.includes("DISMISSED"), "Dismissed events must stay out of formal briefings.");
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
      findMany: async () => [
        { eventItems: [], id: "event-merge", primaryItemId: "item-merge" },
      ],
      findUnique: async () => {
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
