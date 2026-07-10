import type { PrismaClient } from "@prisma/client";
import {
  createDailyBriefing,
  listBriefingsPage,
  listEventsForDailyBriefing,
  listSavedDashboardEvents,
  updateDashboardEventState,
} from "./repositories.js";

export async function runRepositoryFixtures(): Promise<void> {
  await verifySavedPagination();
  await verifyReadPreservesSavedState();
  await verifyDailyBriefingWindowFilter();
  await verifyDailyBriefingUpsert();
  await verifyBriefingHistoryPagination();
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
