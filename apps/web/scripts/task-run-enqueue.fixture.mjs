import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManualTaskRunIdempotencyKey } from "../src/lib/task-run-enqueue.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Key relationship tests ──

const now = new Date("2026-01-15T10:30:45.000Z");

// Same type/user/now → same key
const k1 = buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "u-123", now });
const k2 = buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "u-123", now });
assert.equal(k1, k2, "Same type/user/now must produce same key.");

// Same UTC minute, different second → same key (60s bucket)
const k3 = buildManualTaskRunIdempotencyKey({
  type: "SOURCE_FETCH",
  userId: "u-123",
  now: new Date("2026-01-15T10:30:59.999Z"),
});
assert.equal(k1, k3, "Same UTC minute must produce same key.");

// Next minute → different key
const k4 = buildManualTaskRunIdempotencyKey({
  type: "SOURCE_FETCH",
  userId: "u-123",
  now: new Date("2026-01-15T10:31:00.000Z"),
});
assert.notEqual(k1, k4, "Different UTC minute must produce different key.");

// Different type → different key
const k5 = buildManualTaskRunIdempotencyKey({ type: "SOURCE_DISCOVERY", userId: "u-123", now });
assert.notEqual(k1, k5, "Different type must produce different key.");

// Different user → different key
const k6 = buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "u-456", now });
assert.notEqual(k1, k6, "Different user must produce different key.");

// Key length within [1, 200]
assert.ok(k1.length >= 1 && k1.length <= 200, `Key length must be <= 200 (got ${k1.length}).`);

// Key must not contain URLs, secrets, or arbitrary form input
assert.doesNotMatch(k1, /https?:\/\//, "Key must not contain URLs.");
assert.doesNotMatch(k1, /secret|token|password/i, "Key must not contain secret-like substrings.");

// Long userId (128 chars) still within 200
const kLong = buildManualTaskRunIdempotencyKey({
  type: "SOURCE_DISCOVERY",
  userId: "x".repeat(128),
  now,
});
assert.ok(kLong.length <= 200, `Long userId key must be <= 200 (got ${kLong.length}).`);

// ── Rejection tests ──

// Unknown type
assert.throws(
  () => buildManualTaskRunIdempotencyKey({ type: "CONTENT_FETCH", userId: "u-123", now }),
  /type/i,
  "Unknown type must be rejected.",
);

// Empty userId
assert.throws(
  () => buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "", now }),
  /userId/i,
  "Empty userId must be rejected.",
);

// userId with control characters
assert.throws(
  () => buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "u\n123", now }),
  /control/i,
  "Control characters in userId must be rejected.",
);

// userId exceeding 128 chars
assert.throws(
  () => buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "x".repeat(129), now }),
  /userId/i,
  "userId > 128 chars must be rejected.",
);

// Invalid Date
assert.throws(
  () => buildManualTaskRunIdempotencyKey({ type: "SOURCE_FETCH", userId: "u-123", now: new Date("invalid") }),
  /now|date/i,
  "Invalid Date must be rejected.",
);

// ── Static assertions on sources.ts ──

const sourcesPath = join(__dirname, "..", "src", "app", "actions", "sources.ts");
const sourcesContent = readFileSync(sourcesPath, "utf8");

// enqueueTaskRun must be used at least twice (discovery + fetch)
const enqueueCount = (sourcesContent.match(/enqueueTaskRun/g) ?? []).length;
assert.ok(
  enqueueCount >= 2,
  `enqueueTaskRun must appear at least twice (discovery + fetch); got ${enqueueCount}.`,
);

// createTaskRun must NOT appear at all
assert.ok(
  !sourcesContent.includes("createTaskRun"),
  "createTaskRun must not appear in sources.ts — web must not create initial RUNNING TaskRun.",
);

// maxAttempts must be set to 3
assert.ok(
  sourcesContent.includes("maxAttempts: 3"),
  "maxAttempts must be set to 3 in enqueue calls.",
);

// buildManualTaskRunIdempotencyKey helper must be used
assert.ok(
  sourcesContent.includes("buildManualTaskRunIdempotencyKey"),
  "buildManualTaskRunIdempotencyKey helper must be used in sources.ts.",
);

// Web must not create initial RUNNING status
assert.doesNotMatch(
  sourcesContent,
  /status:\s*["']RUNNING["']/,
  "Web must not create initial RUNNING TaskRun.",
);

process.stdout.write("Task run enqueue fixture passed.\n");