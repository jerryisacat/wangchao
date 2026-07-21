/**
 * Issue #155 — 工作区切换 fixture 测试。
 *
 * 验证 resolveActiveWorkspace + listUserMemberships 的核心行为：
 * 1. cookie 指定的 org 在用户 Membership 列表中 → 返回该 org 作为 active workspace。
 * 2. cookie 指定的 org 不在列表中（过期/无权限）→ fallback 到第一个 Membership。
 * 3. cookie 为空 → fallback 到第一个 Membership（保持现有行为）。
 * 4. 用户没有任何 Membership → 返回 null（由上层决定是否 ensure workspace）。
 * 5. listUserMemberships 返回用户所有 org 及 role，按 createdAt asc 排序。
 */
import type { PrismaClient } from "@prisma/client";
import {
  listUserMemberships,
  resolveActiveWorkspace,
} from "./repositories/workspace.js";
import type { UserMembershipSummary } from "./repositories/types.js";

export async function runWorkspaceSwitchFixtures(): Promise<void> {
  await verifyActiveOrgFromCookieIsSelected();
  await verifyInvalidCookieFallsBackToFirstMembership();
  await verifyNullCookieFallsBackToFirstMembership();
  await verifyNoMembershipsReturnsNull();
  await verifyListUserMembershipsReturnsAllOrgs();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---- Mock helpers ----

interface MockMembership {
  organization: { id: string; name: string; slug: string; createdAt?: Date };
  role: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: Date;
}

interface SwitchMockOptions {
  memberships?: MockMembership[];
}

function createSwitchMock(options: SwitchMockOptions = {}) {
  const memberships = options.memberships ?? [];
  const calls: Array<{ args: unknown; method: string }> = [];

  const prisma = {
    membership: {
      findMany: async (args: unknown) => {
        calls.push({ args, method: "membership.findMany" });
        return memberships.map((m) => ({
          role: m.role,
          createdAt: m.createdAt,
          organization: {
            id: m.organization.id,
            name: m.organization.name,
            slug: m.organization.slug,
          },
        }));
      },
    },
  } as unknown as PrismaClient;
  return { calls, prisma };
}

const membershipsFixture: MockMembership[] = [
  {
    organization: { id: "org-a", name: "Alpha", slug: "alpha" },
    role: "OWNER",
    createdAt: new Date("2024-01-01"),
  },
  {
    organization: { id: "org-b", name: "Beta", slug: "beta" },
    role: "MEMBER",
    createdAt: new Date("2024-06-01"),
  },
];

// ---- Tests ----

async function verifyActiveOrgFromCookieIsSelected(): Promise<void> {
  const { prisma } = createSwitchMock({ memberships: membershipsFixture });
  const result = await resolveActiveWorkspace(prisma, {
    userId: "user-1",
    preferredOrganizationId: "org-b",
  });

  assert(result !== null, "Must resolve a workspace when cookie is set.");
  assert(
    result!.organizationId === "org-b",
    "Cookie-specified org must be selected as active workspace.",
  );
  assert(
    result!.role === "MEMBER",
    "Role must reflect the user's actual role in the cookie-specified org.",
  );
}

async function verifyInvalidCookieFallsBackToFirstMembership(): Promise<void> {
  const { prisma } = createSwitchMock({ memberships: membershipsFixture });
  const result = await resolveActiveWorkspace(prisma, {
    userId: "user-1",
    preferredOrganizationId: "org-deleted",
  });

  assert(result !== null, "Must fall back, not return null.");
  assert(
    result!.organizationId === "org-a",
    "Invalid cookie must fall back to the first (oldest) membership.",
  );
}

async function verifyNullCookieFallsBackToFirstMembership(): Promise<void> {
  const { prisma } = createSwitchMock({ memberships: membershipsFixture });
  const result = await resolveActiveWorkspace(prisma, {
    userId: "user-1",
    preferredOrganizationId: null,
  });

  assert(result !== null, "Must resolve when no cookie is present.");
  assert(
    result!.organizationId === "org-a",
    "No cookie must fall back to the first membership.",
  );
}

async function verifyNoMembershipsReturnsNull(): Promise<void> {
  const { prisma } = createSwitchMock({ memberships: [] });
  const result = await resolveActiveWorkspace(prisma, {
    userId: "user-orphan",
    preferredOrganizationId: null,
  });

  assert(result === null, "User with no memberships must return null.");
}

async function verifyListUserMembershipsReturnsAllOrgs(): Promise<void> {
  const { prisma } = createSwitchMock({ memberships: membershipsFixture });
  const list: UserMembershipSummary[] = await listUserMemberships(prisma, {
    userId: "user-1",
  });

  assert(list.length === 2, "Must return all user memberships.");
  assert(
    list[0]!.organizationId === "org-a",
    "First membership must be the oldest org.",
  );
  assert(
    list[1]!.organizationId === "org-b",
    "Second membership must be the newer org.",
  );
  assert(
    list[0]!.role === "OWNER" && list[1]!.role === "MEMBER",
    "Roles must be preserved per membership.",
  );
}
