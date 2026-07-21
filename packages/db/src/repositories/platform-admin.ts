import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export type PlatformAdminRole = "PLATFORM_OWNER" | "PLATFORM_ADMIN" | "PLATFORM_AUDITOR";

export type PlatformAdminErrorCode = "INVALID_INPUT" | "NOT_FOUND";

export interface PlatformAdminRecord {
  id: string;
  userId: string;
  role: PlatformAdminRole;
  mfaEnabled: boolean | null;
  lastReauthAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignPlatformRoleInput {
  userId: string;
  role: PlatformAdminRole;
}

// Role rank: higher = more privileged. Used for hasPlatformRole checks.
const ROLE_RANK: Readonly<Record<PlatformAdminRole, number>> = {
  PLATFORM_OWNER: 3,
  PLATFORM_ADMIN: 2,
  PLATFORM_AUDITOR: 1,
};

// ─── Domain errors ────────────────────────────────────────────

/**
 * Thrown when a platform admin operation is rejected.
 *
 * Uses stable `code` values that do NOT leak Prisma internals.
 */
export class PlatformAdminError extends Error {
  readonly code: PlatformAdminErrorCode;

  constructor(code: PlatformAdminErrorCode, message: string) {
    super(message);
    this.name = "PlatformAdminError";
    this.code = code;
  }
}

// ─── Repository functions ─────────────────────────────────────

/**
 * Assign or update a platform admin role for a user.
 *
 * Uses upsert so that:
 *   - A new PlatformAdmin row is created if none exists.
 *   - The role is updated if a row already exists.
 *
 * The userId uniqueness constraint (enforced at DB level) guarantees
 * at most one platform role per user.
 */
export async function assignPlatformRole(
  prisma: PrismaClient,
  input: AssignPlatformRoleInput,
  now: Date = new Date(),
): Promise<PlatformAdminRecord> {
  const userId = input.userId.trim();
  if (userId.length === 0) {
    throw new PlatformAdminError("INVALID_INPUT", "userId must not be empty.");
  }

  const result = await prisma.platformAdmin.upsert({
    where: { userId },
    create: {
      userId,
      role: input.role,
      updatedAt: now,
    },
    update: {
      role: input.role,
      updatedAt: now,
    },
  });

  return toRecord(result);
}

/**
 * Get a platform admin record by userId. Returns null if the user
 * has no platform admin role.
 */
export async function getPlatformAdminByUserId(
  prisma: PrismaClient,
  userId: string,
): Promise<PlatformAdminRecord | null> {
  const result = await prisma.platformAdmin.findUnique({
    where: { userId },
  });
  return result ? toRecord(result) : null;
}

/**
 * Check whether a user is a platform admin (any role).
 */
export async function isPlatformAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const count = await prisma.platformAdmin.count({
    where: { userId },
  });
  return count > 0;
}

/**
 * Check whether a user has at least the specified platform role.
 *
 * Returns true if the user's role rank is >= the required role rank.
 * Returns false if the user is not a platform admin or has a lower role.
 */
export async function hasPlatformRole(
  prisma: PrismaClient,
  userId: string,
  requiredRole: PlatformAdminRole,
): Promise<boolean> {
  const admin = await prisma.platformAdmin.findUnique({
    where: { userId },
    select: { role: true },
  });
  if (!admin) return false;
  const userRank = ROLE_RANK[admin.role as PlatformAdminRole] ?? 0;
  const requiredRank = ROLE_RANK[requiredRole] ?? 0;
  return userRank >= requiredRank;
}

/**
 * List all platform admins, ordered by creation time ascending.
 */
export async function listPlatformAdmins(
  prisma: PrismaClient,
): Promise<PlatformAdminRecord[]> {
  const results = await prisma.platformAdmin.findMany({
    orderBy: { createdAt: "asc" },
  });
  return results.map(toRecord);
}

/**
 * Enable or disable MFA for a platform admin.
 */
export async function updatePlatformMfa(
  prisma: PrismaClient,
  userId: string,
  mfaEnabled: boolean,
): Promise<PlatformAdminRecord> {
  const result = await prisma.platformAdmin.update({
    where: { userId },
    data: { mfaEnabled },
  });
  return toRecord(result);
}

/**
 * Record a successful re-authentication timestamp.
 */
export async function updatePlatformReauth(
  prisma: PrismaClient,
  userId: string,
  reauthAt: Date = new Date(),
): Promise<PlatformAdminRecord> {
  const result = await prisma.platformAdmin.update({
    where: { userId },
    data: { lastReauthAt: reauthAt },
  });
  return toRecord(result);
}

/**
 * Remove a platform admin role from a user.
 * Returns true if a row was deleted, false if the user had no platform role.
 */
export async function removePlatformAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const result = await prisma.platformAdmin.deleteMany({
    where: { userId },
  });
  return result.count > 0;
}

// ─── Internal helpers ─────────────────────────────────────────

function toRecord(row: {
  id: string;
  userId: string;
  role: string;
  mfaEnabled: boolean | null;
  lastReauthAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PlatformAdminRecord {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role as PlatformAdminRole,
    mfaEnabled: row.mfaEnabled,
    lastReauthAt: row.lastReauthAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
