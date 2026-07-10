import type { PrismaClient } from "@prisma/client";
import {
  listSavedDashboardEvents,
  updateDashboardEventState,
} from "./repositories.js";

export async function runRepositoryFixtures(): Promise<void> {
  await verifySavedPagination();
  await verifyReadPreservesSavedState();
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
