import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { ensureUserWorkspace } from "./repositories/workspace.js";

export async function runWorkspaceAuthFixtures(): Promise<void> {
  await verifyExistingMembershipIsReusedWithoutWrites();
  await verifyMissingMembershipCreatesDeterministicOwnedWorkspace();
  await verifyWorkspaceSlugIsUserScoped();
  await verifyBlankNameFallsBackToEmail();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

interface WorkspaceMockOptions {
  existingMembership?: {
    organization: { id: string; name: string; slug: string };
    role: "OWNER" | "ADMIN" | "MEMBER";
  } | null;
}

function createWorkspaceMock(options: WorkspaceMockOptions = {}) {
  const calls: Array<{ args: unknown; method: string }> = [];
  const existingMembership = options.existingMembership ?? null;
  const transactionClient = {
    membership: {
      findFirst: async (args: unknown) => {
        calls.push({ args, method: "membership.findFirst" });
        return existingMembership;
      },
      upsert: async (args: unknown) => {
        calls.push({ args, method: "membership.upsert" });
        const data = readRecord(args, "membership.upsert args");
        const create = readRecord(data.create, "membership.upsert create");
        return { role: create.role };
      },
    },
    organization: {
      upsert: async (args: unknown) => {
        calls.push({ args, method: "organization.upsert" });
        const data = readRecord(args, "organization.upsert args");
        const create = readRecord(data.create, "organization.upsert create");
        return {
          id: `org-${String(create.slug)}`,
          name: create.name,
          slug: create.slug,
        };
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transactionClient) => Promise<unknown>) => {
      calls.push({ args: {}, method: "$transaction" });
      return callback(transactionClient);
    },
  } as unknown as PrismaClient;
  return { calls, prisma };
}

async function verifyExistingMembershipIsReusedWithoutWrites(): Promise<void> {
  const { calls, prisma } = createWorkspaceMock({
    existingMembership: {
      organization: { id: "org-existing", name: "Existing", slug: "existing" },
      role: "ADMIN",
    },
  });
  const result = await ensureUserWorkspace(prisma, {
    email: "user@example.com",
    name: "User",
    userId: "user-1",
  });

  assert(result.organizationId === "org-existing", "Existing organization must be reused.");
  assert(result.role === "ADMIN", "Existing membership role must be preserved.");
  assert(
    !calls.some((call) => call.method.endsWith(".upsert")),
    "Existing membership must not write.",
  );
  const find = readRecord(
    calls.find((call) => call.method === "membership.findFirst")?.args,
    "membership.findFirst args",
  );
  const where = readRecord(find.where, "membership.findFirst where");
  assert(where.userId === "user-1", "Membership lookup must be scoped to the authenticated user.");
}

async function verifyMissingMembershipCreatesDeterministicOwnedWorkspace(): Promise<void> {
  const { calls, prisma } = createWorkspaceMock();
  const result = await ensureUserWorkspace(prisma, {
    email: "user@example.com",
    name: "User Name",
    userId: "User_ABC-123",
  });

  const expectedSlug = `user-${createHash("sha256").update("User_ABC-123").digest("hex").slice(0, 24)}`;
  assert(result.organizationSlug === expectedSlug, "Workspace slug must be deterministic.");
  assert(result.organizationName === "User Name 的工作区", "Workspace name must use the user name.");
  assert(result.role === "OWNER", "Provisioned membership must be OWNER.");

  const organizationArgs = readRecord(
    calls.find((call) => call.method === "organization.upsert")?.args,
    "organization.upsert args",
  );
  const organizationWhere = readRecord(organizationArgs.where, "organization.upsert where");
  assert(
    organizationWhere.slug === expectedSlug,
    "Organization upsert must use the deterministic slug as its unique key.",
  );

  const membershipArgs = readRecord(
    calls.find((call) => call.method === "membership.upsert")?.args,
    "membership.upsert args",
  );
  const membershipCreate = readRecord(membershipArgs.create, "membership.upsert create");
  assert(membershipCreate.userId === "User_ABC-123", "Membership must belong to the user.");
  assert(membershipCreate.role === "OWNER", "Membership create role must be OWNER.");
}

async function verifyWorkspaceSlugIsUserScoped(): Promise<void> {
  const first = createWorkspaceMock();
  const second = createWorkspaceMock();
  const firstResult = await ensureUserWorkspace(first.prisma, {
    email: "first@example.com",
    name: "First",
    userId: "first-user",
  });
  const secondResult = await ensureUserWorkspace(second.prisma, {
    email: "second@example.com",
    name: "Second",
    userId: "second-user",
  });
  assert(
    firstResult.organizationSlug !== secondResult.organizationSlug,
    "Different users must receive different deterministic organization slugs.",
  );
}

async function verifyBlankNameFallsBackToEmail(): Promise<void> {
  const { prisma } = createWorkspaceMock();
  const result = await ensureUserWorkspace(prisma, {
    email: "fallback@example.com",
    name: "   ",
    userId: "fallback-user",
  });
  assert(
    result.organizationName === "fallback@example.com 的工作区",
    "Blank user name must fall back to email.",
  );
}
