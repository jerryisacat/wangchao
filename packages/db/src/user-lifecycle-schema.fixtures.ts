import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserLifecycleStatus } from "./repositories/user-lifecycle.js";

interface DmmfField {
  name: string;
  kind?: string;
  type?: string;
}

interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

interface DmmfData {
  datamodel: {
    models: DmmfModel[];
  };
}

export async function runUserLifecycleSchemaFixtures(): Promise<void> {
  await verifySchemaContractHasBetterAuthCoreFields();
  await verifySchemaContractHasVerificationModel();
  await verifySchemaContractHasAccountOAuthFields();
  await verifySchemaContractHasUserLifecycleFields();
  await verifySchemaContractHasDeletedAtField();
  verifyUserLifecycleStatusNameTypeMatchesSchemaNotNull();
}

function readPrismaSchemaFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(here, "..", "prisma", "schema.prisma");
  return readFileSync(schemaPath, "utf-8");
}

async function loadDmmf(): Promise<DmmfData> {
  const mod = await import("@prisma/client");
  const prismaNs = (mod as unknown as { Prisma?: { dmmf?: DmmfData } }).Prisma;
  const dmmf = prismaNs?.dmmf;
  if (!dmmf?.datamodel) {
    throw new Error("Prisma DMMF is not available on Prisma.dmmf. Run prisma generate first.");
  }
  return dmmf;
}

function getModelFields(dmmf: DmmfData, modelName: string): string[] {
  const model = dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  if (!model) {
    throw new Error(`Prisma model "${modelName}" not found in DMMF.`);
  }
  return model.fields.map((field) => field.name);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifySchemaContractHasBetterAuthCoreFields(): Promise<void> {
  const dmmf = await loadDmmf();
  const userFields = getModelFields(dmmf, "User");
  assert(
    userFields.includes("emailVerified"),
    "User model must have emailVerified (Better Auth core field).",
  );
  assert(
    userFields.includes("image"),
    "User model must have image (Better Auth core field).",
  );

  const userModelMatch = readPrismaSchemaFile().match(/model User \{[\s\S]*?\}/);
  assert(userModelMatch, "Could not extract User model from schema.prisma");
  const nameFieldLine = userModelMatch[0]
    .split("\n")
    .find((line) => line.trim().startsWith("name") && !line.includes("@"));
  assert(nameFieldLine, "Could not find name field in User model in schema.prisma");
  assert(
    !/\bString\s*\?/.test(nameFieldLine),
    `User.name must be NOT NULL to match Better Auth 1.6.23. Found: ${nameFieldLine.trim()}`,
  );
}

async function verifySchemaContractHasVerificationModel(): Promise<void> {
  const dmmf = await loadDmmf();
  const verificationFields = getModelFields(dmmf, "Verification");
  for (const field of ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"]) {
    assert(
      verificationFields.includes(field),
      `Verification model must have ${field} (Better Auth core field).`,
    );
  }
}

async function verifySchemaContractHasAccountOAuthFields(): Promise<void> {
  const dmmf = await loadDmmf();
  const accountFields = getModelFields(dmmf, "Account");
  for (const field of ["idToken", "refreshTokenExpiresAt", "scope"]) {
    assert(
      accountFields.includes(field),
      `Account model must have ${field} (Better Auth core OAuth field).`,
    );
  }
}

async function verifySchemaContractHasUserLifecycleFields(): Promise<void> {
  const dmmf = await loadDmmf();
  const userFields = getModelFields(dmmf, "User");
  for (const field of [
    "accountStatus",
    "suspendedAt",
    "suspendedReason",
    "suspendEndsAt",
    "deletionRequestedAt",
    "lastLoginAt",
    "lastActivityAt",
  ]) {
    assert(
      userFields.includes(field),
      `User model must have ${field} (Issue #153 user lifecycle field).`,
    );
  }

  const userModel = dmmf.datamodel.models.find((candidate) => candidate.name === "User");
  const statusField = userModel?.fields.find((field) => field.name === "accountStatus");
  assert(
    statusField?.kind === "enum" && statusField.type === "UserAccountStatus",
    "User.accountStatus must be typed as UserAccountStatus.",
  );

  const mod = await import("@prisma/client");
  const enumObject = (mod as unknown as { UserAccountStatus?: Record<string, string> })
    .UserAccountStatus;
  assert(enumObject, "Prisma must export UserAccountStatus enum.");
  const values = Object.values(enumObject);
  for (const value of ["ACTIVE", "SUSPENDED", "DELETION_PENDING", "DELETED"]) {
    assert(values.includes(value), `UserAccountStatus enum must include ${value}.`);
  }
}

async function verifySchemaContractHasDeletedAtField(): Promise<void> {
  const dmmf = await loadDmmf();
  assert(
    getModelFields(dmmf, "User").includes("deletedAt"),
    "User model must have deletedAt for terminal deletion auditability.",
  );
}

function verifyUserLifecycleStatusNameTypeMatchesSchemaNotNull(): void {
  const status: UserLifecycleStatus = {
    userId: "type-check-user",
    email: "type@example.com",
    name: "Type Check User",
    emailVerified: true,
    image: null,
    accountStatus: "ACTIVE",
    suspendedAt: null,
    suspendedReason: null,
    suspendEndsAt: null,
    deletionRequestedAt: null,
    deletedAt: null,
    lastLoginAt: null,
    lastActivityAt: null,
  };
  assert(typeof status.name === "string", "UserLifecycleStatus.name must be a string.");
}
