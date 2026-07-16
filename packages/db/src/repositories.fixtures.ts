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

export async function runRepositoryFixtures(): Promise<void> {
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
  const topic = readRecord(include.topic, "analysisItems.include.topic");
  const select = readRecord(topic.select, "analysisItems.include.topic.select");
  assert(select.name === true, "Analysis item query must load the current topic name.");
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
  await failTaskRun(prisma, "task-1", new Error("provider unavailable"));

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
  assert(failed.errorMessage === "provider unavailable", "Failure must persist the error reason.");
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
