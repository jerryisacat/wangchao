/**
 * Worker workspace scheduling discovery fixtures for Issue #163 Lane A.
 *
 * Tests `listEligibleWorkerWorkspaces` using mocked PrismaClient.
 * No DATABASE_URL required — these are pure unit tests asserting
 * Prisma where/filter/order/take semantics.
 *
 * Contract:
 *   1. Eligible = Organization with ≥1 Membership whose User.accountStatus === ACTIVE.
 *   2. Each org returns exactly one {organizationId, userId} actor.
 *   3. Actor deterministic: role OWNER→ADMIN→MEMBER (Prisma enum asc),
 *      then membership.createdAt asc, then membership.id asc.
 *   4. Organization order stable: createdAt asc, then id asc.
 *   5. SUSPENDED/DELETION_PENDING/DELETED users never become actor;
 *      org with no ACTIVE member is not returned.
 *   6. No default workspace creation, no DB writes.
 *   7. Tenant-safe: returns minimal IDs only, no email/name/secret.
 */
import type { PrismaClient } from "@prisma/client";
import { listEligibleWorkerWorkspaces } from "./repositories/workspace.js";

export async function runWorkerWorkspaceFixtures(): Promise<void> {
  await verifyReturnsEmptyWhenNoOrganizations();
  await verifyReturnsEmptyWhenOrgHasNoActiveMember();
  await verifyReturnsEmptyWhenAllMembersAreInactive();
  await verifyReturnsOneActorPerEligibleOrg();
  await verifyOrganizationOrderIsCreatedAtAscThenIdAsc();
  await verifyActorPrefersOwnerOverEarlierMember();
  await verifyActorPrefersAdminOverMember();
  await verifySameRoleTiebreaksByCreatedAtAsc();
  await verifySameRoleAndCreatedAtTiebreaksByMembershipIdAsc();
  await verifyOrgWithoutActiveMemberIsExcludedEvenWithMultipleOrgs();
  await verifyResultContainsOnlyOrganizationIdAndUserId();
  await verifyQueryScopesMembershipFilterToActiveUsers();
  await verifyQueryOrdersMembershipsByRoleCreatedAtThenId();
  await verifyQueryTakesExactlyOneMembershipPerOrg();
  await verifyQueryOrdersOrganizationsByCreatedAtThenId();
  await verifyDoesNotWriteToDatabase();
}

// ─── Helpers ──────────────────────────────────────────────────

type Role = "OWNER" | "ADMIN" | "MEMBER";
type AccountStatus = "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" | "DELETED";

interface MockMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: Date;
  user: { accountStatus: AccountStatus };
}

interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberships: MockMembership[];
}

interface MockOptions {
  organizations: MockOrganization[];
}

interface MockPrisma {
  prisma: PrismaClient;
  calls: Array<{ args: unknown; method: string }>;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function makeMembership(
  orgId: string,
  userId: string,
  role: Role,
  createdAt: Date,
  status: AccountStatus = "ACTIVE",
  id = `mbr-${userId}`,
): MockMembership {
  return { id, organizationId: orgId, userId, role, createdAt, user: { accountStatus: status } };
}

function makeOrg(
  id: string,
  createdAt: Date,
  memberships: MockMembership[],
  slug = `org-${id}`,
  name = `Org ${id}`,
): MockOrganization {
  return { id, name, slug, createdAt, memberships };
}

function createMock(options: MockOptions): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const orgs = options.organizations;

  const organization = {
    findMany: async (args: unknown) => {
      calls.push({ args, method: "organization.findMany" });
      // Simulate Prisma query: filter orgs with ≥1 ACTIVE membership,
      // order by createdAt asc then id asc, include memberships with
      // the same filter/order/take.
      const query = readRecord(args, "organization.findMany args");
      const orderBy = query.orderBy;
      const projection = readRecord(query.select ?? {}, "organization.findMany select");
      const membershipInclude = readRecord(
        projection.memberships ?? {},
        "organization.findMany select.memberships",
      );
      const membershipWhere = readRecord(
        membershipInclude.where ?? {},
        "include.memberships.where",
      );
      const membershipOrderBy = membershipInclude.orderBy;
      const membershipTake = membershipInclude.take;

      // Filter orgs: must have ≥1 membership with user.accountStatus === ACTIVE.
      const eligibleOrgs = orgs.filter((org) =>
        org.memberships.some(
          (mbr) =>
            mbr.user.accountStatus === "ACTIVE" &&
            (membershipWhere.user === undefined ||
              readRecord(membershipWhere.user, "where.user").accountStatus === "ACTIVE"),
        ),
      );

      // Sort orgs by createdAt asc, then id asc.
      const sortedOrgs = [...eligibleOrgs].sort((a, b) => {
        if (a.createdAt.getTime() !== b.createdAt.getTime()) {
          return a.createdAt.getTime() - b.createdAt.getTime();
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      // Project results: include filtered/sorted memberships per org.
      return sortedOrgs.map((org) => {
        const activeMembers = org.memberships.filter(
          (mbr) => mbr.user.accountStatus === "ACTIVE",
        );
        const roleRank: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
        const sortedMembers = [...activeMembers].sort((a, b) => {
          if (a.role !== b.role) {
            return roleRank[a.role] - roleRank[b.role];
          }
          if (a.createdAt.getTime() !== b.createdAt.getTime()) {
            return a.createdAt.getTime() - b.createdAt.getTime();
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        const take = typeof membershipTake === "number" ? membershipTake : sortedMembers.length;
        const takenMembers = sortedMembers.slice(0, take);
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          createdAt: org.createdAt,
          memberships: takenMembers.map((mbr) => ({
            id: mbr.id,
            organizationId: mbr.organizationId,
            userId: mbr.userId,
            role: mbr.role,
            createdAt: mbr.createdAt,
            user: { accountStatus: mbr.user.accountStatus },
          })),
        };
      });
    },
  };

  const prisma = { organization } as unknown as PrismaClient;
  return { prisma, calls };
}

// ─── Behavior tests ───────────────────────────────────────────

async function verifyReturnsEmptyWhenNoOrganizations(): Promise<void> {
  const { prisma } = createMock({ organizations: [] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(Array.isArray(result), "Result must be an array.");
  assert(result.length === 0, "Empty organization set must return empty array.");
}

async function verifyReturnsEmptyWhenOrgHasNoActiveMember(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-solo", t0, [
    makeMembership("org-solo", "user-suspended", "OWNER", t0, "SUSPENDED"),
    makeMembership("org-solo", "user-deleted", "ADMIN", t0, "DELETED"),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(
    result.length === 0,
    "Org with only inactive members must not be returned.",
  );
}

async function verifyReturnsEmptyWhenAllMembersAreInactive(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-mixed", t0, [
    makeMembership("org-mixed", "u-susp", "OWNER", t0, "SUSPENDED"),
    makeMembership("org-mixed", "u-pending", "ADMIN", t0, "DELETION_PENDING"),
    makeMembership("org-mixed", "u-deleted", "MEMBER", t0, "DELETED"),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 0, "All-inactive org must return empty.");
}

async function verifyReturnsOneActorPerEligibleOrg(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const t1 = new Date("2026-07-18T01:00:00.000Z");
  const orgA = makeOrg("org-a", t0, [
    makeMembership("org-a", "user-a", "OWNER", t0),
  ]);
  const orgB = makeOrg("org-b", t1, [
    makeMembership("org-b", "user-b", "ADMIN", t1),
  ]);
  const { prisma } = createMock({ organizations: [orgA, orgB] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 2, "Two eligible orgs must return two actors.");
  assert(
    result.every((actor: { organizationId: string; userId: string }) =>
      Object.keys(actor).sort().join(",") === "organizationId,userId"
    ),
    "Each actor must have exactly organizationId and userId keys.",
  );
}

async function verifyOrganizationOrderIsCreatedAtAscThenIdAsc(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const t1 = new Date("2026-07-18T01:00:00.000Z");
  const orgEarlyB = makeOrg("org-bbb", t0, [
    makeMembership("org-bbb", "u1", "OWNER", t0),
  ]);
  const orgLaterA = makeOrg("org-aaa", t1, [
    makeMembership("org-aaa", "u2", "OWNER", t1),
  ]);
  const { prisma } = createMock({ organizations: [orgLaterA, orgEarlyB] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 2, "Both orgs should be eligible.");
  assert(
    result[0]!.organizationId === "org-bbb",
    "Org with earlier createdAt must come first.",
  );
  assert(
    result[1]!.organizationId === "org-aaa",
    "Org with later createdAt must come second.",
  );

  // Same createdAt → id asc tiebreak
  const orgX = makeOrg("org-x", t0, [
    makeMembership("org-x", "uX", "OWNER", t0),
  ]);
  const orgY = makeOrg("org-y", t0, [
    makeMembership("org-y", "uY", "OWNER", t0),
  ]);
  const mock2 = createMock({ organizations: [orgY, orgX] });
  const result2 = await listEligibleWorkerWorkspaces(mock2.prisma);
  assert(
    result2[0]!.organizationId === "org-x",
    "Same createdAt must tiebreak by id asc (org-x before org-y).",
  );
  assert(result2[1]!.organizationId === "org-y", "Same createdAt: org-y after org-x.");
}

async function verifyActorPrefersOwnerOverEarlierMember(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const t1 = new Date("2026-07-18T01:00:00.000Z");
  // MEMBER created earlier than OWNER, but OWNER must win (role priority).
  const org = makeOrg("org-role", t0, [
    makeMembership("org-role", "u-member-early", "MEMBER", t0),
    makeMembership("org-role", "u-owner-late", "OWNER", t1),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 1, "Single org returns one actor.");
  assert(
    result[0]!.userId === "u-owner-late",
    "OWNER must be chosen over an earlier MEMBER despite createdAt.",
  );
}

async function verifyActorPrefersAdminOverMember(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-am", t0, [
    makeMembership("org-am", "u-member", "MEMBER", t0, "ACTIVE", "mbr-1"),
    makeMembership("org-am", "u-admin", "ADMIN", t0, "ACTIVE", "mbr-2"),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(
    result[0]!.userId === "u-admin",
    "ADMIN must be chosen over MEMBER when createdAt is equal.",
  );
}

async function verifySameRoleTiebreaksByCreatedAtAsc(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const t1 = new Date("2026-07-18T01:00:00.000Z");
  const org = makeOrg("org-tie", t0, [
    makeMembership("org-tie", "u-late", "OWNER", t1, "ACTIVE", "mbr-late"),
    makeMembership("org-tie", "u-early", "OWNER", t0, "ACTIVE", "mbr-early"),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(
    result[0]!.userId === "u-early",
    "Same role must tiebreak by createdAt asc.",
  );
}

async function verifySameRoleAndCreatedAtTiebreaksByMembershipIdAsc(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-id", t0, [
    makeMembership("org-id", "u-zzz", "OWNER", t0, "ACTIVE", "mbr-zzz"),
    makeMembership("org-id", "u-aaa", "OWNER", t0, "ACTIVE", "mbr-aaa"),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(
    result[0]!.userId === "u-aaa",
    "Same role and createdAt must tiebreak by membership.id asc.",
  );
}

async function verifyOrgWithoutActiveMemberIsExcludedEvenWithMultipleOrgs(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const t1 = new Date("2026-07-18T01:00:00.000Z");
  const eligible = makeOrg("org-good", t1, [
    makeMembership("org-good", "u-good", "OWNER", t1),
  ]);
  const ineligible = makeOrg("org-bad", t0, [
    makeMembership("org-bad", "u-bad", "OWNER", t0, "SUSPENDED"),
  ]);
  const { prisma } = createMock({ organizations: [eligible, ineligible] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 1, "Only the org with an ACTIVE member must be returned.");
  assert(
    result[0]!.organizationId === "org-good",
    "Ineligible org must be excluded even if it was created earlier.",
  );
}

async function verifyResultContainsOnlyOrganizationIdAndUserId(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-min", t0, [
    makeMembership("org-min", "u-min", "OWNER", t0),
  ]);
  const { prisma } = createMock({ organizations: [org] });
  const result = await listEligibleWorkerWorkspaces(prisma);
  assert(result.length === 1, "One eligible org returns one actor.");
  const actor = result[0]!;
  const keys = Object.keys(actor).sort();
  assert(
    keys.length === 2 && keys.includes("organizationId") && keys.includes("userId"),
    `Actor must expose only organizationId and userId, got: ${keys.join(",")}.`,
  );
  assert(
    typeof actor.organizationId === "string" && typeof actor.userId === "string",
    "Actor IDs must be strings.",
  );
}

// ─── Prisma query semantics tests ──────────────────────────────

async function verifyQueryScopesMembershipFilterToActiveUsers(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-q", t0, [makeMembership("org-q", "u", "OWNER", t0)]);
  const { prisma, calls } = createMock({ organizations: [org] });
  await listEligibleWorkerWorkspaces(prisma);
  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  assert(findManyCall, "listEligibleWorkerWorkspaces must call organization.findMany.");
  const args = readRecord(findManyCall!.args, "organization.findMany args");
  const select = readRecord(args.select ?? {}, "select");
  const membershipsInclude = readRecord(
    select.memberships ?? {},
    "include.memberships",
  );
  const where = readRecord(membershipsInclude.where ?? {}, "memberships.where");
  const userWhere = readRecord(where.user ?? {}, "memberships.where.user");
  assert(
    userWhere.accountStatus === "ACTIVE",
    "Memberships must be filtered to user.accountStatus === ACTIVE.",
  );
}

async function verifyQueryOrdersMembershipsByRoleCreatedAtThenId(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-o", t0, [makeMembership("org-o", "u", "OWNER", t0)]);
  const { prisma, calls } = createMock({ organizations: [org] });
  await listEligibleWorkerWorkspaces(prisma);
  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  const args = readRecord(findManyCall!.args, "args");
  const select = readRecord(args.select ?? {}, "select");
  const membershipsInclude = readRecord(
    select.memberships ?? {},
    "include.memberships",
  );
  const orderBy = membershipsInclude.orderBy;
  assert(Array.isArray(orderBy), "Memberships orderBy must be an array.");
  const orderArr = orderBy as Array<Record<string, unknown>>;
  assert(orderArr.length >= 3, "Memberships orderBy must have ≥3 clauses.");
  const roleOrder = orderArr[0];
  assert(roleOrder !== undefined && roleOrder.role === "asc",
    "First membership orderBy must be role asc.");
  const createdAtOrder = orderArr[1];
  assert(createdAtOrder !== undefined && createdAtOrder.createdAt === "asc",
    "Second membership orderBy must be createdAt asc.");
  const idOrder = orderArr[2];
  assert(idOrder !== undefined && idOrder.id === "asc",
    "Third membership orderBy must be id asc.");
}

async function verifyQueryTakesExactlyOneMembershipPerOrg(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-t", t0, [makeMembership("org-t", "u", "OWNER", t0)]);
  const { prisma, calls } = createMock({ organizations: [org] });
  await listEligibleWorkerWorkspaces(prisma);
  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  const args = readRecord(findManyCall!.args, "args");
  const select = readRecord(args.select ?? {}, "select");
  const membershipsInclude = readRecord(
    select.memberships ?? {},
    "include.memberships",
  );
  assert(
    membershipsInclude.take === 1,
    "Memberships include must take exactly 1 (one actor per org).",
  );
}

async function verifyQueryOrdersOrganizationsByCreatedAtThenId(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-qo", t0, [makeMembership("org-qo", "u", "OWNER", t0)]);
  const { prisma, calls } = createMock({ organizations: [org] });
  await listEligibleWorkerWorkspaces(prisma);
  const findManyCall = calls.find((c) => c.method === "organization.findMany");
  const args = readRecord(findManyCall!.args, "args");
  const orderBy = args.orderBy;
  assert(Array.isArray(orderBy), "Organization orderBy must be an array.");
  const orderArr = orderBy as Array<Record<string, unknown>>;
  assert(orderArr.length >= 2, "Organization orderBy must have ≥2 clauses.");
  const createdAtOrder = orderArr[0];
  assert(createdAtOrder !== undefined && createdAtOrder.createdAt === "asc",
    "First organization orderBy must be createdAt asc.");
  const idOrder = orderArr[1];
  assert(idOrder !== undefined && idOrder.id === "asc",
    "Second organization orderBy must be id asc.");
}

async function verifyDoesNotWriteToDatabase(): Promise<void> {
  const t0 = new Date("2026-07-18T00:00:00.000Z");
  const org = makeOrg("org-nw", t0, [makeMembership("org-nw", "u", "OWNER", t0)]);
  const { prisma, calls } = createMock({ organizations: [org] });
  await listEligibleWorkerWorkspaces(prisma);
  const writeMethods = calls.filter((c) =>
    c.method.endsWith(".create") ||
    c.method.endsWith(".update") ||
    c.method.endsWith(".upsert") ||
    c.method.endsWith(".delete") ||
    c.method.endsWith(".deleteMany") ||
    c.method.endsWith(".updateMany") ||
    c.method === "$transaction",
  );
  assert(
    writeMethods.length === 0,
    "listEligibleWorkerWorkspaces must not write to DB or use $transaction.",
  );
  assert(
    calls.length === 1 && calls[0] !== undefined && calls[0].method === "organization.findMany",
    "listEligibleWorkerWorkspaces must only call organization.findMany.",
  );
}