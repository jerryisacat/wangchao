import {
  classifyTaskRunError,
  completeTaskRun,
  createDeliveryLog,
  createTaskRun,
  ensureDefaultWorkspace,
  failTaskRun,
  findBriefingsForTelegramDelivery,
  getPrismaClient,
  listActiveTopics,
  listEligibleWorkerWorkspaces,
  markItemFiltered,
  mergeSemanticEvents,
  recordUsageEvent,
} from "@wangchao/db";
import { runOrganizationFetchCycles } from "./organization-cycle.js";
import { runFetchCycleForWorkspace } from "./fetch-cycle.js";
import type { OrganizationFetchCycleDeps } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

interface FixtureIds {
  prefix: string;
  orgA: string;
  orgB: string;
  orgInactive: string;
  userA: string;
  userB: string;
  userInactive: string;
  topicA: string;
  topicB: string;
  sourceA: string;
  sourceB: string;
  itemAKeep: string;
  itemAMerge: string;
  itemB: string;
  eventAKeep: string;
  eventAMerge: string;
  eventB: string;
  briefingA: string;
  briefingB: string;
}

export async function runOrganizationCyclePgFixtures(): Promise<void> {
  const databaseUrl = requireDisposableDatabaseUrl();
  if (databaseUrl === null) return;
  const prisma = getPrismaClient();
  const ids = createIds();
  const previousEnv = configureDefaultWorkspace(ids);
  try {
    await seedFixture(prisma, ids);
    await verifyRepositoryIsolation(prisma, ids);
    await verifyDestructiveFences(prisma, ids);
    await verifyOrganizationOrchestration(prisma, ids);
  } finally {
    restoreDefaultWorkspace(previousEnv);
    await cleanupFixture(prisma, ids);
  }
}

function requireDisposableDatabaseUrl(): string | null {
  if (process.env.RUN_ORGANIZATION_CYCLE_PG_TESTS !== "1") return null;
  if (process.env.WANGCHAO_DISPOSABLE_DATABASE !== "1") {
    throw new Error("Organization PG fixtures require WANGCHAO_DISPOSABLE_DATABASE=1.");
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Organization PG fixtures require DATABASE_URL.");
  const parsed = new URL(raw);
  if (!new Set(["127.0.0.1", "localhost"]).has(parsed.hostname)) {
    throw new Error("Organization PG fixtures only run against localhost.");
  }
  if (!parsed.pathname.toLowerCase().includes("organization_cycle_pg")) {
    throw new Error("Disposable database name must contain organization_cycle_pg.");
  }
  return raw;
}

function createIds(): FixtureIds {
  const prefix = `orgpg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const id = (suffix: string) => `${prefix}-${suffix}`;
  return {
    prefix,
    orgA: id("org-a"), orgB: id("org-b"), orgInactive: id("org-inactive"),
    userA: id("user-a"), userB: id("user-b"), userInactive: id("user-inactive"),
    topicA: id("topic-a"), topicB: id("topic-b"),
    sourceA: id("source-a"), sourceB: id("source-b"),
    itemAKeep: id("item-a-keep"), itemAMerge: id("item-a-merge"), itemB: id("item-b"),
    eventAKeep: id("event-a-keep"), eventAMerge: id("event-a-merge"), eventB: id("event-b"),
    briefingA: id("briefing-a"), briefingB: id("briefing-b"),
  };
}

async function seedFixture(prisma: PrismaClient, ids: FixtureIds): Promise<void> {
  await seedOrganization(prisma, ids.orgA, ids.userA, "A", ids.prefix, "ACTIVE");
  await seedOrganization(prisma, ids.orgB, ids.userB, "B", ids.prefix, "ACTIVE");
  await seedOrganization(prisma, ids.orgInactive, ids.userInactive, "I", ids.prefix, "SUSPENDED");
  await seedTopicGraph(prisma, ids, "A");
  await seedTopicGraph(prisma, ids, "B");
}

async function seedOrganization(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  marker: string,
  prefix: string,
  accountStatus: "ACTIVE" | "SUSPENDED",
): Promise<void> {
  await prisma.organization.create({
    data: { id: organizationId, name: `${marker}-${prefix}`, slug: `${organizationId}-slug` },
  });
  await prisma.user.create({
    data: { id: userId, email: `${userId}@fixture.invalid`, name: `${marker}-user`, accountStatus },
  });
  await prisma.membership.create({
    data: { organizationId, userId, role: "OWNER" },
  });
}

async function seedTopicGraph(
  prisma: PrismaClient,
  ids: FixtureIds,
  marker: "A" | "B",
): Promise<void> {
  const isA = marker === "A";
  const organizationId = isA ? ids.orgA : ids.orgB;
  const userId = isA ? ids.userA : ids.userB;
  const topicId = isA ? ids.topicA : ids.topicB;
  const sourceId = isA ? ids.sourceA : ids.sourceB;
  await prisma.topic.create({ data: { id: topicId, organizationId, ownerUserId: userId, name: `${marker}-${ids.prefix}` } });
  await prisma.source.create({ data: {
    id: sourceId, organizationId, topicId, status: "MUTED", name: `${marker}-source`,
    url: `https://${marker.toLowerCase()}.example.test/feed`, canonicalUrl: `https://${marker.toLowerCase()}.example.test/feed`,
  } });
  await seedItemsAndEvents(prisma, ids, marker);
  await prisma.briefing.create({ data: {
    id: isA ? ids.briefingA : ids.briefingB, organizationId, topicId, title: `${marker}-briefing`,
    content: `${marker}-content`, markdown: `${marker}-markdown`,
    rangeStart: new Date("2026-07-17T00:00:00Z"), rangeEnd: new Date("2026-07-18T00:00:00Z"),
  } });
}

async function seedItemsAndEvents(
  prisma: PrismaClient,
  ids: FixtureIds,
  marker: "A" | "B",
): Promise<void> {
  const isA = marker === "A";
  const organizationId = isA ? ids.orgA : ids.orgB;
  const topicId = isA ? ids.topicA : ids.topicB;
  const sourceId = isA ? ids.sourceA : ids.sourceB;
  const itemIds = isA ? [ids.itemAKeep, ids.itemAMerge] : [ids.itemB];
  for (const itemId of itemIds) {
    await prisma.item.create({ data: {
      id: itemId, organizationId, topicId, sourceId, title: `${marker}-${itemId}`,
      url: `https://${marker.toLowerCase()}.example.test/${itemId}`,
      canonicalUrl: `https://${marker.toLowerCase()}.example.test/${itemId}`,
    } });
  }
  const eventIds = isA ? [ids.eventAKeep, ids.eventAMerge] : [ids.eventB];
  for (let index = 0; index < eventIds.length; index += 1) {
    await prisma.intelligenceEvent.create({ data: {
      id: eventIds[index]!, organizationId, topicId, primaryItemId: itemIds[index] ?? itemIds[0],
      title: `${marker}-event-${index}`, summary: `${marker}-summary-${index}`,
    } });
  }
}

async function verifyRepositoryIsolation(prisma: PrismaClient, ids: FixtureIds): Promise<void> {
  const actors = await listEligibleWorkerWorkspaces(prisma);
  assert(actors.some((actor) => actor.organizationId === ids.orgA && actor.userId === ids.userA), "Org A actor missing.");
  assert(actors.some((actor) => actor.organizationId === ids.orgB && actor.userId === ids.userB), "Org B actor missing.");
  assert(!actors.some((actor) => actor.organizationId === ids.orgInactive), "Inactive org must be excluded.");
  const topicsA = await listActiveTopics(prisma, { organizationId: ids.orgA });
  const topicsB = await listActiveTopics(prisma, { organizationId: ids.orgB });
  assert(topicsA.length === 1 && topicsA[0]?.id === ids.topicA, "Org A topic query leaked or missed data.");
  assert(topicsB.length === 1 && topicsB[0]?.id === ids.topicB, "Org B topic query leaked or missed data.");
  const since = new Date("2026-07-16T00:00:00Z");
  const deliveryA = await findBriefingsForTelegramDelivery(prisma, { organizationId: ids.orgA }, since);
  const deliveryB = await findBriefingsForTelegramDelivery(prisma, { organizationId: ids.orgB }, since);
  assert(deliveryA.length === 1 && deliveryA[0]?.briefingId === ids.briefingA, "Org A delivery query crossed tenant scope.");
  assert(deliveryB.length === 1 && deliveryB[0]?.briefingId === ids.briefingB, "Org B delivery query crossed tenant scope.");
  await createDeliveryLog(prisma, { organizationId: ids.orgA, briefingId: ids.briefingA, channel: "TELEGRAM", status: "PENDING" });
  await createDeliveryLog(prisma, { organizationId: ids.orgB, briefingId: ids.briefingB, channel: "TELEGRAM", status: "PENDING" });
}

async function verifyDestructiveFences(prisma: PrismaClient, ids: FixtureIds): Promise<void> {
  await mergeSemanticEvents(prisma, {
    organizationId: ids.orgA, keepEventId: ids.eventAKeep,
    mergeEventIds: [ids.eventAMerge], reason: "same event",
  });
  const mergedA = await prisma.intelligenceEvent.findUniqueOrThrow({ where: { id: ids.eventAMerge } });
  assert(mergedA.status === "ARCHIVED", "In-scope semantic merge must archive the A target.");
  await expectReject(() => mergeSemanticEvents(prisma, {
    organizationId: ids.orgA, keepEventId: ids.eventAKeep,
    mergeEventIds: [ids.eventB], reason: "cross tenant attempt",
  }));
  const eventB = await prisma.intelligenceEvent.findUniqueOrThrow({ where: { id: ids.eventB } });
  assert(eventB.status === "UNREAD", "Cross-tenant merge must not mutate org B event.");
  await expectReject(() => markItemFiltered(prisma, { organizationId: ids.orgA }, ids.itemB, "cross tenant"));
  const itemB = await prisma.item.findUniqueOrThrow({ where: { id: ids.itemB } });
  assert(itemB.status === "FETCHED", "Cross-tenant filtered update must not mutate org B item.");
}

async function verifyOrganizationOrchestration(prisma: PrismaClient, ids: FixtureIds): Promise<void> {
  const startedAt = new Date();
  const deps = createRealDbDeps(prisma, ids);
  const result = await runOrganizationFetchCycles({ deps, prisma, overallBudgetMs: 30_000 });
  const summaryA = result.summaries.find((summary) => summary.organizationId === ids.orgA);
  const summaryB = result.summaries.find((summary) => summary.organizationId === ids.orgB);
  assert(summaryA?.status === "FAILED", "Org A controlled failure must be isolated.");
  assert(summaryB?.status === "SUCCEEDED", "Org B must continue after org A failure.");
  const serialized = JSON.stringify(result);
  assert(!serialized.includes(ids.userA) && !serialized.includes(ids.userB), "Summary must not expose actor userId.");
  assert(!serialized.includes("fixture-secret"), "Summary must not expose raw credential errors.");
  const taskRuns = await prisma.taskRun.findMany({ where: { createdAt: { gte: startedAt }, organizationId: { in: [ids.orgA, ids.orgB] } } });
  assert(taskRuns.some((run) => run.organizationId === ids.orgA && run.status === "FAILED"), "Org A outer TaskRun must fail.");
  assert(taskRuns.some((run) => run.organizationId === ids.orgB && run.status === "SUCCEEDED"), "Org B outer TaskRun must succeed.");
  assert(taskRuns.every((run) => !run.errorMessage?.includes("fixture-secret")), "TaskRun must not persist raw errors.");
  const usageB = await prisma.usageEvent.findMany({ where: { organizationId: ids.orgB, createdAt: { gte: startedAt } } });
  assert(usageB.length >= 1, "Org B production runner must create org-scoped UsageEvents.");
  assert(usageB.every((event) => event.organizationId === ids.orgB), "UsageEvents must remain in org B scope.");
  const deliveryCounts = await prisma.deliveryLog.groupBy({ by: ["organizationId"], where: { organizationId: { in: [ids.orgA, ids.orgB] } }, _count: true });
  assert(deliveryCounts.every((row) => row._count === 1), "Each org must retain exactly one DeliveryLog.");
}

function createRealDbDeps(prisma: PrismaClient, ids: FixtureIds): OrganizationFetchCycleDeps {
  return {
    ensureDefaultWorkspace: () => ensureDefaultWorkspace(prisma),
    listEligibleWorkerWorkspaces: () => listEligibleWorkerWorkspaces(prisma),
    createTaskRun: (_client, input) => createTaskRun(prisma, input),
    completeTaskRun: (_client, taskRunId, output) => completeTaskRun(prisma, taskRunId, output),
    failTaskRun: (_client, taskRunId, error) => failTaskRun(prisma, taskRunId, error),
    classifyTaskRunError,
    runFetchCycleForWorkspace: async (_client, workspace) => {
      if (workspace.organizationId === ids.orgA) {
        throw new Error("https://user:fixture-secret@upstream.invalid/failure");
      }
      if (workspace.organizationId === ids.orgB) {
        const topics = await listActiveTopics(prisma, { organizationId: ids.orgB });
        assert(topics.length === 1 && topics[0]?.id === ids.topicB, "Controlled B runner must use B scope.");
        const productionResult = await runFetchCycleForWorkspace(prisma, workspace);
        assert(productionResult.failedSources === 0, "Production B fetch pipeline must complete without source failures.");
        await recordUsageEvent(prisma, {
          organizationId: ids.orgB, userId: ids.userB, type: "FETCH", quantity: 1,
          unit: "cycle", subjectType: "organization-cycle-pg",
        });
      }
      return {};
    },
    resetWorkspaceBudgetMs: () => {}, resetOverallBudgetMs: () => {},
    isWorkspaceTimeExhausted: () => false, nowFn: () => Date.now(),
  };
}

function configureDefaultWorkspace(ids: FixtureIds): Record<string, string | undefined> {
  const keys = ["WANGCHAO_DEFAULT_ORGANIZATION_SLUG", "WANGCHAO_DEFAULT_USER_EMAIL", "WANGCHAO_DEFAULT_USER_NAME"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.WANGCHAO_DEFAULT_ORGANIZATION_SLUG = `${ids.orgA}-slug`;
  process.env.WANGCHAO_DEFAULT_USER_EMAIL = `${ids.userA}@fixture.invalid`;
  process.env.WANGCHAO_DEFAULT_USER_NAME = "A-user";
  return previous;
}

function restoreDefaultWorkspace(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function cleanupFixture(prisma: PrismaClient, ids: FixtureIds): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB, ids.orgInactive] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB, ids.userInactive] } } });
}

async function expectReject(action: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  assert(rejected, "Expected operation to reject.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
