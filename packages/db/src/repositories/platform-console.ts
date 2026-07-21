import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export interface PlatformConsoleUser {
  id: string;
  email: string;
  name: string;
  accountStatus: string;
  lastLoginAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  membershipCount: number;
}

export interface PlatformConsoleWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  memberCount: number;
  createdAt: Date;
}

export interface PlatformConsolePage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface PlatformConsolePagination {
  page: number;
  pageSize: number;
}

// ─── Repository functions ─────────────────────────────────────

/**
 * List all users for the platform console (read-only).
 *
 * Returns paginated users with:
 *   - accountStatus / lastLoginAt / lastActivityAt / createdAt
 *   - membershipCount (via _count on memberships relation)
 *
 * Ordering: createdAt desc (newest first).
 * This is a read-only operation: only findMany + count are called.
 */
export async function listUsersForConsole(
  prisma: PrismaClient,
  pagination: PlatformConsolePagination,
): Promise<PlatformConsolePage<PlatformConsoleUser>> {
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  const skip = (page - 1) * pageSize;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        accountStatus: true,
        lastLoginAt: true,
        lastActivityAt: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    }),
    prisma.user.count(),
  ]);

  const items: PlatformConsoleUser[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    accountStatus: row.accountStatus,
    lastLoginAt: row.lastLoginAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    membershipCount: row._count.memberships,
  }));

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.ceil(total / pageSize),
  };
}

/**
 * List all workspaces (organizations) for the platform console (read-only).
 *
 * Returns paginated organizations with:
 *   - plan / status (from the Subscription 1:1 relation)
 *   - memberCount (via _count on memberships relation)
 *
 * Ordering: createdAt desc (newest first).
 * This is a read-only operation: only findMany + count are called.
 */
export async function listWorkspacesForConsole(
  prisma: PrismaClient,
  pagination: PlatformConsolePagination,
): Promise<PlatformConsolePage<PlatformConsoleWorkspace>> {
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  const skip = (page - 1) * pageSize;

  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        subscription: {
          select: { plan: true, status: true },
        },
        _count: { select: { memberships: true } },
      },
    }),
    prisma.organization.count(),
  ]);

  const items: PlatformConsoleWorkspace[] = rows.map((row) => {
    // Organization.subscription is a 1:N relation in the schema (array),
    // but organizationId is @unique so at most one row exists.
    const sub = row.subscription[0];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: sub?.plan ?? "FREE",
      status: sub?.status ?? "ACTIVE",
      memberCount: row._count.memberships,
      createdAt: row.createdAt,
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.ceil(total / pageSize),
  };
}
