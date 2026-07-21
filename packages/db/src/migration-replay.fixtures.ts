/**
 * Migration replay verification fixture for Issue #153 Lane 1A.
 *
 * This fixture verifies that the full migration chain (0001->0016) replays
 * correctly against a disposable PostgreSQL instance, and that the resulting
 * schema matches Better Auth 1.6.23 core contract + user lifecycle fields.
 *
 * It is intended to be run AFTER `prisma migrate deploy` against a clean DB.
 *
 * Prerequisites: the caller must have already created a "pre-existing" user
 * at schema version 0015 state (before 0016 applied accountStatus/emailVerified)
 * and left it in the database. This fixture verifies that user gets correct
 * defaults after 0016 is applied.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set for migration replay fixtures.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export async function runMigrationReplayFixtures(): Promise<void> {
  await verifyAccountStatusIsPostgresEnum();
  await verifyUserLifecycleColumnsExist();
  await verifyBetterAuthCoreFieldsExist();
  await verifyVerificationTableExists();
  await verifyAccountOAuthFieldsExist();
  await verifyPreExistingUserUpgradedWithCorrectDefaults();
  await verifyNewUserCreatedAfterMigrationUsesCorrectDefaults();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function getColumnType(
  prisma: PrismaClient,
  table: string,
  column: string,
): Promise<string> {
  const result = await prisma.$queryRawUnsafe<
    Array<{ data_type: string }>
  >(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return result[0]?.data_type ?? "NOT_FOUND";
}

async function getColumnNullable(
  prisma: PrismaClient,
  table: string,
  column: string,
): Promise<boolean | null> {
  const result = await prisma.$queryRawUnsafe<
    Array<{ is_nullable: string }>
  >(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  if (result.length === 0 || !result[0]) return null;
  return result[0].is_nullable === "YES";
}

async function enumExists(
  prisma: PrismaClient,
  enumName: string,
): Promise<boolean> {
  const result = await prisma.$queryRawUnsafe<
    Array<{ exists: boolean }>
  >(
    `SELECT EXISTS (
       SELECT 1 FROM pg_type WHERE typname = $1
     ) as exists`,
    enumName,
  );
  return result[0]?.exists ?? false;
}

async function getEnumValues(
  prisma: PrismaClient,
  enumName: string,
): Promise<string[]> {
  const result = await prisma.$queryRawUnsafe<
    Array<{ enumlabel: string }>
  >(
    `SELECT e.enumlabel
     FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = $1
     ORDER BY e.enumsortorder`,
    enumName,
  );
  return result.map((r) => r.enumlabel);
}

async function verifyAccountStatusIsPostgresEnum(): Promise<void> {
  const prisma = createClient();
  try {
    assert(
      await enumExists(prisma, "UserAccountStatus"),
      'PostgreSQL enum "UserAccountStatus" must exist after migration replay.',
    );
    const values = await getEnumValues(prisma, "UserAccountStatus");
    assert(
      values.includes("ACTIVE"),
      "UserAccountStatus enum must include ACTIVE.",
    );
    assert(
      values.includes("SUSPENDED"),
      "UserAccountStatus enum must include SUSPENDED.",
    );
    assert(
      values.includes("DELETION_PENDING"),
      "UserAccountStatus enum must include DELETION_PENDING.",
    );
    assert(
      values.includes("DELETED"),
      "UserAccountStatus enum must include DELETED.",
    );
    const colType = await getColumnType(prisma, "User", "accountStatus");
    assert(
      colType === "USER-DEFINED",
      `accountStatus column must be a PostgreSQL enum (USER-DEFINED), got: ${colType}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyUserLifecycleColumnsExist(): Promise<void> {
  const prisma = createClient();
  try {
    for (const col of [
      "accountStatus",
      "suspendedAt",
      "suspendedReason",
      "suspendEndsAt",
      "deletionRequestedAt",
      "lastLoginAt",
      "lastActivityAt",
    ]) {
      const colType = await getColumnType(prisma, "User", col);
      assert(
        colType !== "NOT_FOUND",
        `User.${col} must exist after migration replay.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyBetterAuthCoreFieldsExist(): Promise<void> {
  const prisma = createClient();
  try {
    const emailVerifiedType = await getColumnType(prisma, "User", "emailVerified");
    assert(
      emailVerifiedType === "boolean",
      `User.emailVerified must be boolean, got: ${emailVerifiedType}.`,
    );
    const imageType = await getColumnType(prisma, "User", "image");
    assert(
      imageType === "text",
      `User.image must be text, got: ${imageType}.`,
    );
    // Better Auth 1.6.23 core schema: user.name is ZodString (required, NOT nullable).
    // Verify the DB column enforces NOT NULL to match the contract.
    const nameNullable = await getColumnNullable(prisma, "User", "name");
    assert(
      nameNullable === false,
      `User.name must be NOT NULL to match Better Auth 1.6.23 core schema (ZodString required), got is_nullable=${nameNullable}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyVerificationTableExists(): Promise<void> {
  const prisma = createClient();
  try {
    const result = await prisma.$queryRawUnsafe<
      Array<{ table_exists: boolean }>
    >(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'Verification'
       ) as table_exists`,
    );
    assert(
      result[0]?.table_exists === true,
      '"Verification" table must exist after migration replay.',
    );
    for (const col of [
      "id",
      "identifier",
      "value",
      "expiresAt",
      "createdAt",
      "updatedAt",
    ]) {
      const colType = await getColumnType(prisma, "Verification", col);
      assert(
        colType !== "NOT_FOUND",
        `Verification.${col} must exist.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyAccountOAuthFieldsExist(): Promise<void> {
  const prisma = createClient();
  try {
    for (const col of ["refreshTokenExpiresAt", "idToken", "scope"]) {
      const colType = await getColumnType(prisma, "Account", col);
      assert(
        colType !== "NOT_FOUND",
        `Account.${col} must exist (Better Auth OAuth field).`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Verify that a user created BEFORE migration 0016 (i.e. at schema version
 * 0015, when User table had no accountStatus/emailVerified columns) gets
 * correct defaults after 0016 is applied.
 *
 * The caller is responsible for creating this pre-existing user via psql
 * after deploying migrations 0001-0015 but BEFORE deploying 0016.
 * The user must have:
 *   id = 'preexisting-replay-user'
 *   email = 'preexisting@replay-test.local'
 *   name = 'Pre-existing Replay User'
 * This fixture checks the defaults were backfilled correctly.
 */
async function verifyPreExistingUserUpgradedWithCorrectDefaults(): Promise<void> {
  const prisma = createClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: "preexisting-replay-user" },
      select: {
        email: true,
        emailVerified: true,
        accountStatus: true,
      },
    });

    assert(
      user !== null,
      "Pre-existing user 'preexisting-replay-user' must exist. " +
        "Caller must create it after deploying 0001-0015 but before 0016.",
    );
    assert(
      user!.email === "preexisting@replay-test.local",
      `Pre-existing user email mismatch, got: ${user!.email}.`,
    );
    assert(
      user!.emailVerified === false,
      "Pre-existing user must default to emailVerified=false after migration 0016.",
    );
    assert(
      user!.accountStatus === "ACTIVE",
      "Pre-existing user must default to accountStatus=ACTIVE after migration 0016.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Verify that a new user created AFTER migration 0016 also gets correct
 * defaults (this validates the column DEFAULT on new inserts, as opposed
 * to the backfill of existing rows).
 */
async function verifyNewUserCreatedAfterMigrationUsesCorrectDefaults(): Promise<void> {
  const prisma = createClient();
  try {
    // Make the fixture idempotent: delete a leftover row from a prior run
    // before creating it again. This allows re-running the replay against
    // the same database without a unique-constraint failure.
    await prisma.user.deleteMany({ where: { id: "newuser-replay-test" } });

    await prisma.user.create({
      data: {
        id: "newuser-replay-test",
        email: "newuser@replay-test.local",
        name: "New Replay User",
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: "newuser-replay-test" },
      select: {
        emailVerified: true,
        accountStatus: true,
      },
    });

    assert(
      user !== null,
      "New user must be creatable after migration 0016.",
    );
    assert(
      user!.emailVerified === false,
      "New user must default to emailVerified=false.",
    );
    assert(
      user!.accountStatus === "ACTIVE",
      "New user must default to accountStatus=ACTIVE.",
    );

    await prisma.user.delete({ where: { id: "newuser-replay-test" } });
  } finally {
    await prisma.$disconnect();
  }
}
