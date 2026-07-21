/**
 * TaskRun lease/idempotency schema contract fixture for Issue #162 Lane 1A.
 *
 * Verifies Prisma DMMF fields, schema indexes, and migration SQL partial
 * unique index contract. No DATABASE_URL required - pure schema assertions.
 *
 * Contract:
 * - TaskRun gains nullable idempotencyKey, leaseOwner, leaseToken,
 *   leaseExpiresAt, heartbeatAt.
 * - attempt/maxAttempts/scheduledAt/startedAt/finishedAt preserved.
 * - TaskRunStatus enum unchanged (no new values).
 * - Due scan index [status, type, scheduledAt] added.
 * - Migration: expand-only ADD COLUMN; partial unique index on
 *   (organizationId, type, idempotencyKey) WHERE idempotencyKey IS NOT NULL
 *   AND status IN ('PENDING','RUNNING').
 * - Prisma schema must NOT declare a fake global @@unique on idempotencyKey
 *   because Prisma cannot express partial unique indexes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface DmmfField {
  name: string;
  kind?: string;
  type?: string;
}

interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

interface DmmfEnumValue {
  name: string;
  dbName: string | null;
}

interface DmmfEnum {
  name: string;
  values: DmmfEnumValue[];
}

interface DmmfData {
  datamodel: {
    models: DmmfModel[];
    enums: DmmfEnum[];
  };
}

export async function runTaskRunSchemaFixtures(): Promise<void> {
  await verifyTaskRunHasLeaseAndIdempotencyFields();
  await verifyTaskRunPreservesExistingLifecycleFields();
  await verifyTaskRunStatusEnumUnchanged();
  verifyTaskRunHasDueScanIndex();
  verifyMigrationAddsLeaseColumns();
  verifyMigrationCreatesDueScanIndex();
  verifyMigrationCreatesPartialUniqueIdempotencyIndex();
  verifySchemaDoesNotDeclareFakeGlobalUnique();
}

// ── helpers ──

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readPrismaSchemaFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(here, "..", "prisma", "schema.prisma");
  return readFileSync(schemaPath, "utf-8");
}

function readMigrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(
    here,
    "..",
    "prisma",
    "migrations",
    "0017_task_run_lease_queue",
    "migration.sql",
  );
  assert(
    existsSync(migrationPath),
    `Migration file not found: ${migrationPath}. ` +
      "Lane 1A requires migration 0017_task_run_lease_queue/migration.sql.",
  );
  return readFileSync(migrationPath, "utf-8");
}

async function loadDmmf(): Promise<DmmfData> {
  const mod = await import("@prisma/client");
  const prismaNs = (mod as unknown as { Prisma?: { dmmf?: DmmfData } }).Prisma;
  const dmmf = prismaNs?.dmmf;
  if (!dmmf?.datamodel) {
    throw new Error(
      "Prisma DMMF is not available on Prisma.dmmf. Run prisma generate first.",
    );
  }
  return dmmf;
}

function getModelFields(dmmf: DmmfData, modelName: string): string[] {
  const model = dmmf.datamodel.models.find((c) => c.name === modelName);
  if (!model) {
    throw new Error(`Prisma model "${modelName}" not found in DMMF.`);
  }
  return model.fields.map((f) => f.name);
}

function extractTaskRunModelText(schema: string): string {
  const match = schema.match(/model TaskRun \{[\s\S]*?\n\}/);
  assert(match, "Could not extract TaskRun model from schema.prisma.");
  return match[0];
}

// ── DMMF field assertions ──

async function verifyTaskRunHasLeaseAndIdempotencyFields(): Promise<void> {
  const dmmf = await loadDmmf();
  const fields = getModelFields(dmmf, "TaskRun");
  for (const field of [
    "idempotencyKey",
    "leaseOwner",
    "leaseToken",
    "leaseExpiresAt",
    "heartbeatAt",
  ]) {
    assert(
      fields.includes(field),
      `TaskRun must have ${field} (Issue #162 lease/idempotency field).`,
    );
  }
}

async function verifyTaskRunPreservesExistingLifecycleFields(): Promise<void> {
  const dmmf = await loadDmmf();
  const fields = getModelFields(dmmf, "TaskRun");
  for (const field of [
    "attempt",
    "maxAttempts",
    "scheduledAt",
    "startedAt",
    "finishedAt",
  ]) {
    assert(
      fields.includes(field),
      `TaskRun must preserve existing field ${field}.`,
    );
  }
}

async function verifyTaskRunStatusEnumUnchanged(): Promise<void> {
  const mod = await import("@prisma/client");
  const enumObject =
    (mod as unknown as { TaskRunStatus?: Record<string, string> })
      .TaskRunStatus;
  assert(
    enumObject,
    "Prisma must export TaskRunStatus enum.",
  );
  const values = Object.values(enumObject);
  for (const expected of [
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
  ]) {
    assert(
      values.includes(expected),
      `TaskRunStatus must include ${expected}.`,
    );
  }
  assert(
    values.length === 5,
    `TaskRunStatus must have exactly 5 values (no new enum values in Lane 1A), got: ${values.length}.`,
  );
}

// ── schema text assertions ──

function verifyTaskRunHasDueScanIndex(): void {
  const schema = readPrismaSchemaFile();
  const modelText = extractTaskRunModelText(schema);
  assert(
    /@@index\(\[status,\s*type,\s*scheduledAt\]\)/.test(modelText),
    "TaskRun must have @@index([status, type, scheduledAt]) for due scan.",
  );
}

function verifySchemaDoesNotDeclareFakeGlobalUnique(): void {
  const schema = readPrismaSchemaFile();
  const modelText = extractTaskRunModelText(schema);
  assert(
    !/@@unique\(\[.*idempotencyKey.*\]\)/.test(modelText),
    "TaskRun must NOT declare @@unique involving idempotencyKey. " +
      "Partial unique index is migration-owned (PostgreSQL only); " +
      "a global @@unique would block terminal-state key reuse.",
  );
}

// ── migration SQL assertions ──

function verifyMigrationAddsLeaseColumns(): void {
  const sql = readMigrationSql();
  for (const col of [
    "idempotencyKey",
    "leaseOwner",
    "leaseToken",
    "leaseExpiresAt",
    "heartbeatAt",
  ]) {
    assert(
      new RegExp(`ADD\\s+COLUMN[^;]*"${col}"`, "i").test(sql),
      `Migration must ADD COLUMN "${col}" to TaskRun table.`,
    );
  }
}

function verifyMigrationCreatesDueScanIndex(): void {
  const sql = readMigrationSql();
  assert(
    /CREATE\s+INDEX[^;]+"TaskRun"[^;]*"status"[^;]*"type"[^;]*"scheduledAt"/i.test(
      sql,
    ),
    "Migration must create due scan index on TaskRun(status, type, scheduledAt).",
  );
}

function verifyMigrationCreatesPartialUniqueIdempotencyIndex(): void {
  const sql = readMigrationSql();
  assert(
    /CREATE\s+UNIQUE\s+INDEX/i.test(sql),
    "Migration must create a UNIQUE INDEX for active idempotency.",
  );
  assert(
    /CREATE\s+UNIQUE\s+INDEX[^;]+WHERE/i.test(sql),
    "Migration unique index must be PARTIAL (include WHERE clause).",
  );
  assert(
    sql.includes('"idempotencyKey" IS NOT NULL'),
    'Migration partial unique index must predicate on "idempotencyKey" IS NOT NULL.',
  );
  assert(
    sql.includes("'PENDING'") && sql.includes("'RUNNING'"),
    "Migration partial unique index must restrict status IN ('PENDING', 'RUNNING').",
  );
  assert(
    sql.includes('"organizationId"') &&
      sql.includes('"type"') &&
      sql.includes('"idempotencyKey"'),
    "Migration partial unique index must cover (organizationId, type, idempotencyKey).",
  );
}
