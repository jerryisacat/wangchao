/**
 * Platform console read-only queries for Issue #156.
 *
 * Tests the platform console repository using mocked PrismaClient.
 * No DATABASE_URL required — pure unit tests.
 *
 * Key constraints:
 *   * All queries are read-only (findMany/count). No write calls.
 *   * Every function accepts pagination (page/pageSize) and returns total + page metadata.
 *   * User rows include accountStatus, lastLoginAt, and membership count.
 *   * Workspace rows include plan, status, and member count.
 *   * Data must NOT leak across tenants — these are platform-level aggregates.
 */
import type { PrismaClient } from "@prisma/client";
import {
  listUsersForConsole,
  listWorkspacesForConsole,
  type PlatformConsoleUser,
  type PlatformConsoleWorkspace,
  type PlatformConsolePage,
} from "./repositories/platform-console.js";

export async function runPlatformConsoleFixtures(): Promise<void> {
  // ── listUsersForConsole ──
  await verifyListUsersReturnsPaginatedResults();
  await verifyListUsersIncludesAccountStatusAndLastLoginAt();
  await verifyListUsersIncludesMembershipCount();
  await verifyListUsersAppliesPagination();
  await verifyListUsersReturnsCorrectTotal();
  await verifyListUsersOrdersByCreatedAtDesc();
  await verifyListUsersIsReadOnly();

  // ── listWorkspacesForConsole ──
  await verifyListWorkspacesReturnsPaginatedResults();
  await verifyListWorkspacesIncludesPlanAndStatus();
  await verifyListWorkspacesIncludesMemberCount();
  await verifyListWorkspacesAppliesPagination();
  await verifyListWorkspacesReturnsCorrectTotal();
  await verifyListWorkspacesOrdersByCreatedAtDesc();
  await verifyListWorkspacesIsReadOnly();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected object for ${label}, got: ${String(value)}`);
  }
  return value as Record<string, unknown>;
}

// ─── Mock helpers ─────────────────────────────────────────────

interface MockUserRow {
  id: string;
  email: string;
  name: string;
  accountStatus: string;
  lastLoginAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  _count?: { memberships: number };
}

interface MockOrgRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  // Prisma select returns subscription as an array (Organization.subscription is 1:N in schema)
  subscription: Array<{ plan: string; status: string }>;
  _count?: { memberships: number };
}

interface MockPrisma {
  prisma: {
    user: {
      findMany: (args: unknown) => Promise<MockUserRow[]>;
      count: (args: unknown) => Promise<number>;
    };
    organization: {
      findMany: (args: unknown) => Promise<MockOrgRow[]>;
      count: (args: unknown) => Promise<number>;
    };
  };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockPrisma(users: MockUserRow[], orgs: MockOrgRow[], userTotal?: number, orgTotal?: number): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  return {
    prisma: {
      user: {
        findMany: async (args: unknown) => {
          calls.push({ args, method: "user.findMany" });
          return users;
        },
        count: async (args: unknown) => {
          calls.push({ args, method: "user.count" });
          return userTotal ?? users.length;
        },
      },
      organization: {
        findMany: async (args: unknown) => {
          calls.push({ args, method: "organization.findMany" });
          return orgs;
        },
        count: async (args: unknown) => {
          calls.push({ args, method: "organization.count" });
          return orgTotal ?? orgs.length;
        },
      },
    },
    calls,
  };
}

function makeUser(overrides: Partial<MockUserRow> = {}): MockUserRow {
  return {
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    accountStatus: "ACTIVE",
    lastLoginAt: new Date("2026-07-20T10:00:00.000Z"),
    lastActivityAt: new Date("2026-07-20T11:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    _count: { memberships: 2 },
    ...overrides,
  };
}

function makeOrg(overrides: Partial<MockOrgRow> = {}): MockOrgRow {
  return {
    id: "org-1",
    name: "Alice 的工作区",
    slug: "org-1-slug",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    subscription: [{ plan: "PLUS", status: "ACTIVE" }],
    _count: { memberships: 3 },
    ...overrides,
  };
}

// ─── listUsersForConsole tests ────────────────────────────────

async function verifyListUsersReturnsPaginatedResults(): Promise<void> {
  const user = makeUser();
  const { prisma } = createMockPrisma([user], [], 100);
  const result = await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(result.items.length === 1, "Must return user items.");
  assert(result.page === 1, "Must return current page.");
  assert(result.pageSize === 20, "Must return page size.");
  assert(result.total === 100, "Must return total count.");
  assert(result.pageCount === 5, "pageCount must be ceil(100/20)=5.");
}

async function verifyListUsersIncludesAccountStatusAndLastLoginAt(): Promise<void> {
  const user = makeUser({ accountStatus: "SUSPENDED", lastLoginAt: new Date("2026-07-15T08:00:00.000Z") });
  const { prisma } = createMockPrisma([user], [], 1);
  const result = await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const item = result.items[0]!;
  assert(item.accountStatus === "SUSPENDED", "Must include accountStatus.");
  assert(item.lastLoginAt !== null, "Must include lastLoginAt.");
}

async function verifyListUsersIncludesMembershipCount(): Promise<void> {
  const user = makeUser({ _count: { memberships: 5 } });
  const { prisma } = createMockPrisma([user], [], 1);
  const result = await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const item = result.items[0]!;
  assert(item.membershipCount === 5, "Must include membership count.");
}

async function verifyListUsersAppliesPagination(): Promise<void> {
  const { prisma, calls } = createMockPrisma([makeUser()], [], 50);
  await listUsersForConsole(prisma as unknown as PrismaClient, { page: 3, pageSize: 10 });

  const findManyCall = calls.find((c) => c.method === "user.findMany");
  assert(findManyCall, "Must call user.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  assert(args.take === 10, "findMany take must equal pageSize.");
  assert(args.skip === 20, "findMany skip must equal (page-1)*pageSize = 20.");
}

async function verifyListUsersReturnsCorrectTotal(): Promise<void> {
  const { prisma, calls } = createMockPrisma([], [], 42);
  const result = await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(result.total === 42, "total must come from user.count.");
  assert(calls.some((c) => c.method === "user.count"), "Must call user.count for total.");
}

async function verifyListUsersOrdersByCreatedAtDesc(): Promise<void> {
  const { prisma, calls } = createMockPrisma([makeUser()], [], 1);
  await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const findManyCall = calls.find((c) => c.method === "user.findMany");
  const args = readRecord(findManyCall!.args, "findMany args");
  const orderBy = readRecord(args.orderBy, "findMany.orderBy");
  assert(orderBy.createdAt === "desc", "Must order by createdAt desc (newest first).");
}

async function verifyListUsersIsReadOnly(): Promise<void> {
  const { prisma, calls } = createMockPrisma([makeUser()], [], 1);
  await listUsersForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(
    !calls.some((c) => c.method.includes("create") || c.method.includes("update") || c.method.includes("delete")),
    "listUsersForConsole must NOT call any write methods (read-only).",
  );
}

// ─── listWorkspacesForConsole tests ───────────────────────────

async function verifyListWorkspacesReturnsPaginatedResults(): Promise<void> {
  const org = makeOrg();
  const { prisma } = createMockPrisma([], [org], 0, 50);
  const result = await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(result.items.length === 1, "Must return workspace items.");
  assert(result.total === 50, "Must return total count.");
  assert(result.pageCount === 3, "pageCount must be ceil(50/20)=3.");
}

async function verifyListWorkspacesIncludesPlanAndStatus(): Promise<void> {
  const org = makeOrg({ subscription: [{ plan: "PRO", status: "PAST_DUE" }] });
  const { prisma } = createMockPrisma([], [org], 0, 1);
  const result = await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const item = result.items[0]!;
  assert(item.plan === "PRO", "Must include plan from subscription.");
  assert(item.status === "PAST_DUE", "Must include status from subscription.");
}

async function verifyListWorkspacesIncludesMemberCount(): Promise<void> {
  const org = makeOrg({ _count: { memberships: 7 } });
  const { prisma } = createMockPrisma([], [org], 0, 1);
  const result = await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const item = result.items[0]!;
  assert(item.memberCount === 7, "Must include member count.");
}

async function verifyListWorkspacesAppliesPagination(): Promise<void> {
  const { prisma, calls } = createMockPrisma([], [makeOrg()], 0, 50);
  await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 2, pageSize: 15 });

  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  assert(findManyCall, "Must call organization.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  assert(args.take === 15, "findMany take must equal pageSize.");
  assert(args.skip === 15, "findMany skip must equal (page-1)*pageSize = 15.");
}

async function verifyListWorkspacesReturnsCorrectTotal(): Promise<void> {
  const { prisma, calls } = createMockPrisma([], [], 0, 33);
  const result = await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(result.total === 33, "total must come from organization.count.");
  assert(calls.some((c) => c.method === "organization.count"), "Must call organization.count for total.");
}

async function verifyListWorkspacesOrdersByCreatedAtDesc(): Promise<void> {
  const { prisma, calls } = createMockPrisma([], [makeOrg()], 0, 1);
  await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  const args = readRecord(findManyCall!.args, "findMany args");
  const orderBy = readRecord(args.orderBy, "findMany.orderBy");
  assert(orderBy.createdAt === "desc", "Must order by createdAt desc (newest first).");
}

async function verifyListWorkspacesIsReadOnly(): Promise<void> {
  const { prisma, calls } = createMockPrisma([], [makeOrg()], 0, 1);
  await listWorkspacesForConsole(prisma as unknown as PrismaClient, { page: 1, pageSize: 20 });

  assert(
    !calls.some((c) => c.method.includes("create") || c.method.includes("update") || c.method.includes("delete")),
    "listWorkspacesForConsole must NOT call any write methods (read-only).",
  );
}
