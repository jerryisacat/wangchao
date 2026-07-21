/**
 * Disposable PostgreSQL fixtures for Issue #172 — UserItemState user isolation.
 *
 * Freezes real PostgreSQL two-user isolation invariants against a disposable
 * database. No production code/schema/migration is modified.
 *
 * Fail-closed guard: only runs when ALL of:
 *   - RUN_USER_ITEM_STATE_PG_TESTS=1      (explicit opt-in)
 *   - WANGCHAO_DISPOSABLE_DATABASE=1      (acknowledge disposable DB)
 *   - DATABASE_URL host is localhost or 127.0.0.1
 *   - DATABASE_URL database name contains "user_item_state_pg"
 * Otherwise: skip (opt-in not enabled) or refuse (enabled but guard mismatched).
 *
 * Uses only production repository APIs: listDashboardEvents /
 * listSavedDashboardEvents / updateDashboardEventState. No direct table
 * mutation except cascade cleanup via Organization delete.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  listDashboardEvents,
  listSavedDashboardEvents,
  updateDashboardEventState,
} from "./repositories/event.js";

// ── Constants ──

const SUITE_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 20_000;

// ── Helpers ──

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `[user-item-state-pg] TIMEOUT: ${label} exceeded ${timeoutMs}ms.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Fail-closed guard ──

type GuardResult =
  | { kind: "skip"; message: string }
  | { kind: "refuse"; message: string }
  | { kind: "proceed"; dbUrl: string };

function parseDatabaseUrl(
  url: string,
): { host: string; dbName: string } | null {
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, "");
    return { host: parsed.hostname, dbName };
  } catch {
    return null;
  }
}

function evaluateGuard(): GuardResult {
  if (process.env.RUN_USER_ITEM_STATE_PG_TESTS !== "1") {
    return {
      kind: "skip",
      message:
        "[user-item-state-pg] SKIP: RUN_USER_ITEM_STATE_PG_TESTS=1 not set (opt-in not enabled).",
    };
  }
  if (process.env.WANGCHAO_DISPOSABLE_DATABASE !== "1") {
    return {
      kind: "refuse",
      message:
        "[user-item-state-pg] REFUSE: RUN_USER_ITEM_STATE_PG_TESTS=1 is set but " +
        "WANGCHAO_DISPOSABLE_DATABASE is not 1. " +
        "The fixture only runs against a disposable database.",
    };
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      kind: "refuse",
      message:
        "[user-item-state-pg] REFUSE: RUN_USER_ITEM_STATE_PG_TESTS=1 is set but " +
        "DATABASE_URL is not set.",
    };
  }
  const parsed = parseDatabaseUrl(dbUrl);
  if (!parsed) {
    return {
      kind: "refuse",
      message: "[user-item-state-pg] REFUSE: DATABASE_URL is not a valid URL.",
    };
  }
  if (parsed.host !== "localhost" && parsed.host !== "127.0.0.1") {
    return {
      kind: "refuse",
      message:
        `[user-item-state-pg] REFUSE: DATABASE_URL host must be localhost or ` +
        `127.0.0.1 (got "${parsed.host}").`,
    };
  }
  if (!parsed.dbName.includes("user_item_state_pg")) {
    return {
      kind: "refuse",
      message:
        `[user-item-state-pg] REFUSE: DATABASE_URL database name must contain ` +
        `"user_item_state_pg" (got "${parsed.dbName}").`,
    };
  }
  return { kind: "proceed", dbUrl };
}

// ── Fixture context ──

interface FixtureContext {
  runId: string;
  orgId: string;
  orgSlug: string;
  topicId: string;
  sourceId: string;
  itemId: string;
  eventIds: [string, string, string];
  userA: string;
  userB: string;
}

function createFixtureContext(): FixtureContext {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const runId = `${stamp}${rand}`;
  return {
    runId,
    orgId: `org-pg-${runId}`,
    orgSlug: `user-item-state-pg-${runId}`,
    topicId: `topic-${runId}`,
    sourceId: `source-${runId}`,
    itemId: `item-${runId}`,
    eventIds: [`event-${runId}-1`, `event-${runId}-2`, `event-${runId}-3`] as [string, string, string],
    userA: `user-A-${runId}`,
    userB: `user-B-${runId}`,
  };
}

async function setupFixtures(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  // Organization owns everything; cascade delete cleans up.
  await prisma.organization.create({
    data: {
      id: ctx.orgId,
      name: `UserItemState PG Fixture ${ctx.runId}`,
      slug: ctx.orgSlug,
    },
  });
  // Two users in the same org (shared feed, separate personal states).
  await prisma.user.createMany({
    data: [
      {
        id: ctx.userA,
        email: `a-${ctx.runId}@fixture.test`,
        name: "User A",
      },
      {
        id: ctx.userB,
        email: `b-${ctx.runId}@fixture.test`,
        name: "User B",
      },
    ],
  });
  await prisma.topic.create({
    data: {
      id: ctx.topicId,
      organizationId: ctx.orgId,
      name: `Topic ${ctx.runId}`,
      status: "ACTIVE",
    },
  });
  // ACTIVE source (briefing/timeline queries fence by source.status === ACTIVE).
  await prisma.source.create({
    data: {
      id: ctx.sourceId,
      organizationId: ctx.orgId,
      topicId: ctx.topicId,
      name: `Source ${ctx.runId}`,
      url: `https://fixture.test/${ctx.runId}`,
      canonicalUrl: `https://fixture.test/${ctx.runId}`,
      status: "ACTIVE",
    },
  });
  await prisma.item.create({
    data: {
      id: ctx.itemId,
      organizationId: ctx.orgId,
      topicId: ctx.topicId,
      sourceId: ctx.sourceId,
      title: `Item ${ctx.runId}`,
      url: `https://fixture.test/${ctx.runId}/item`,
      canonicalUrl: `https://fixture.test/${ctx.runId}/item`,
      status: "ANALYZED",
    },
  });
  // Three events, all UNREAD at the org level (lifecycle).
  await prisma.intelligenceEvent.createMany({
    data: ctx.eventIds.map((id, i) => ({
      id,
      organizationId: ctx.orgId,
      topicId: ctx.topicId,
      primaryItemId: ctx.itemId,
      status: "UNREAD",
      title: `Event ${ctx.runId} #${i + 1}`,
      summary: `Summary ${i + 1}`,
      summaryStatus: "READY",
      eventHash: `${ctx.runId}-hash-${i + 1}`,
      gravityScore: 10 - i,
    })),
  });
}

async function cleanupFixtures(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  // Cascade delete from Organization cleans events, items, sources, topics,
  // user states, feedback events. Users are deleted explicitly (no org cascade).
  await prisma.user.deleteMany({
    where: { id: { in: [ctx.userA, ctx.userB] } },
  });
  await prisma.organization.deleteMany({ where: { id: ctx.orgId } });
}

// ── Entry point ──

export async function runUserItemStatePgFixtures(): Promise<void> {
  const guard = evaluateGuard();
  if (guard.kind === "skip") {
    console.log(guard.message);
    return;
  }
  if (guard.kind === "refuse") {
    throw new Error(guard.message);
  }
  await withTimeout(
    "user-item-state-pg-fixture-suite",
    () => runAllTests(guard.dbUrl),
    SUITE_TIMEOUT_MS,
  );
}

async function runAllTests(dbUrl: string): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: dbUrl }),
  });
  const ctx = createFixtureContext();
  try {
    await setupFixtures(prisma, ctx);
    try {
      await withTimeout(
        "invariant-1-user-a-read-does-not-affect-user-b-feed",
        () => verifyUserAReadDoesNotAffectUserBFeed(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-2-user-a-dismiss-does-not-affect-user-b-feed",
        () => verifyUserADismissDoesNotAffectUserBFeed(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-3-user-a-save-does-not-leak-saved-to-user-b",
        () => verifyUserASaveDoesNotLeakSavedToUserB(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-4-read-does-not-write-intelligence-event-status",
        () => verifyReadDoesNotWriteIntelligenceEventStatus(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
    } finally {
      await cleanupFixtures(prisma, ctx);
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(
    `[user-item-state-pg] ALL PASS (org=${ctx.orgId}): ` +
      `4 two-user isolation invariants verified against real PostgreSQL.`,
  );
}

// ── Invariant 1: User A read must not remove the event from User B's feed ──

async function verifyUserAReadDoesNotAffectUserBFeed(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const [eventId] = ctx.eventIds;

  // Before any action: both users see all 3 events.
  const feedA0 = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  const feedB0 = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userB,
  });
  assert(
    feedA0.length === 3 && feedB0.length === 3,
    `Pre-condition: both users should see all 3 events (A=${feedA0.length}, B=${feedB0.length}).`,
  );

  // User A reads one event.
  await updateDashboardEventState(prisma, {
    action: "read",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });

  // User A: that event disappears from feed (moved to READ).
  const feedA1 = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  assert(
    feedA1.length === 2,
    `User A should now see 2 events after reading one (got ${feedA1.length}).`,
  );
  assert(
    !feedA1.some((e) => e.eventId === eventId),
    "User A should no longer see the read event in the main feed.",
  );

  // User B: STILL sees all 3 events — A's read must not leak.
  const feedB1 = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userB,
  });
  assert(
    feedB1.length === 3,
    `SPEC §5.5 VIOLATION: User A's read leaked to User B (B sees ${feedB1.length} instead of 3).`,
  );
  assert(
    feedB1.some((e) => e.eventId === eventId),
    "SPEC §5.5 VIOLATION: User B must still see the event User A read.",
  );
}

// ── Invariant 2: User A dismiss must not remove the event from User B's feed ──

async function verifyUserADismissDoesNotAffectUserBFeed(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const [, eventId] = ctx.eventIds;

  await updateDashboardEventState(prisma, {
    action: "dismiss",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });

  // User A: dismissed event disappears from feed.
  const feedA = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  assert(
    !feedA.some((e) => e.eventId === eventId),
    "User A should no longer see the dismissed event in the main feed.",
  );

  // User B: STILL sees the dismissed event.
  const feedB = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userB,
  });
  assert(
    feedB.some((e) => e.eventId === eventId),
    "SPEC §5.5 VIOLATION: User A's dismiss leaked to User B (B can no longer see the event).",
  );
}

// ── Invariant 3: User A's save must not mark the event saved for User B ──

async function verifyUserASaveDoesNotLeakSavedToUserB(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const [eventId] = ctx.eventIds;

  // User A saves the event.
  await updateDashboardEventState(prisma, {
    action: "save",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });

  // User A's saved collection includes the event.
  const savedA = await listSavedDashboardEvents(
    prisma,
    { organizationId: ctx.orgId, userId: ctx.userA },
    1,
    50,
  );
  assert(
    savedA.events.some((e) => e.eventId === eventId),
    "User A's saved collection must include the saved event.",
  );

  // User B's saved collection does NOT include it.
  const savedB = await listSavedDashboardEvents(
    prisma,
    { organizationId: ctx.orgId, userId: ctx.userB },
    1,
    50,
  );
  assert(
    !savedB.events.some((e) => e.eventId === eventId),
    "SPEC §5.5 VIOLATION: User A's save leaked into User B's saved collection.",
  );

  // User B's feed record for the event must show userSaved=false even though
  // User A saved it.
  const feedB = await listDashboardEvents(prisma, {
    organizationId: ctx.orgId,
    userId: ctx.userB,
  });
  const recordB = feedB.find((e) => e.eventId === eventId);
  assert(recordB !== undefined, "User B must still see the event in feed.");
  assert(
    recordB.userSaved === false,
    `SPEC §5.5 VIOLATION: userSaved must be false for User B (got ${String(recordB.userSaved)}).`,
  );
}

// ── Invariant 4: read/dismiss must not mutate IntelligenceEvent.status ──

async function verifyReadDoesNotWriteIntelligenceEventStatus(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const [eventId] = ctx.eventIds;

  // Snapshot org-level status before.
  const before = await prisma.intelligenceEvent.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true },
  });

  // User A reads + dismisses + saves (full action sweep).
  await updateDashboardEventState(prisma, {
    action: "read",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  await updateDashboardEventState(prisma, {
    action: "dismiss",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  await updateDashboardEventState(prisma, {
    action: "save",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });
  await updateDashboardEventState(prisma, {
    action: "unsave",
    eventId,
    organizationId: ctx.orgId,
    userId: ctx.userA,
  });

  // Org-level status must be unchanged (still UNREAD lifecycle default).
  const after = await prisma.intelligenceEvent.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true },
  });
  assert(
    before.status === after.status,
    `SPEC §5.5 VIOLATION: personal read/dismiss/save/unsave mutated IntelligenceEvent.status ` +
      `(before=${before.status}, after=${after.status}). Org-level lifecycle status must be immutable by personal actions.`,
  );

  // But User A's UserItemState must reflect the final personal action.
  const userStateA = await prisma.userItemState.findUnique({
    where: {
      userId_eventId: { userId: ctx.userA, eventId },
    },
  });
  assert(userStateA !== null, "User A must have a UserItemState row.");
  // Final action was unsave → saved=false, status stays last personal status.
  assert(
    userStateA.saved === false,
    `User A saved must be false after unsave (got ${String(userStateA.saved)}).`,
  );

  // User B must have NO UserItemState for this event.
  const userStateB = await prisma.userItemState.findUnique({
    where: {
      userId_eventId: { userId: ctx.userB, eventId },
    },
  });
  assert(
    userStateB === null,
    "SPEC §5.5 VIOLATION: User A's actions created a UserItemState for User B.",
  );
}
