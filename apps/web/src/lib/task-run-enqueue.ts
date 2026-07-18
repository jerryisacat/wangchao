/**
 * Web manual producer -> durable enqueue helper for Issue #162 Lane 2C.
 *
 * Web server actions no longer create initial RUNNING TaskRun rows.
 * Instead they enqueue a PENDING TaskRun via `enqueueTaskRun` with an
 * idempotency key derived from a 60-second UTC time bucket. This
 * suppresses double-click / retry concurrency without leaking task ids
 * or internal errors to the user.
 *
 * Security:
 *  - Key is derived only from type + userId + UTC minute bucket.
 *  - No URL, secret, or arbitrary form input is embedded in the key.
 *  - Only SOURCE_FETCH / SOURCE_DISCOVERY are accepted (web manual
 *    producers). Other types are rejected.
 */

const ALLOWED_MANUAL_TYPES = new Set(["SOURCE_FETCH", "SOURCE_DISCOVERY"] as const);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const MAX_USER_ID_LENGTH = 128;
const MAX_KEY_LENGTH = 200;

export type ManualTaskRunType = "SOURCE_FETCH" | "SOURCE_DISCOVERY";

export interface ManualIdempotencyKeyInput {
  type: ManualTaskRunType;
  userId: string;
  now?: Date;
}

/**
 * Build a stable idempotency key for a manual dashboard task enqueue.
 *
 * The key is derived from:
 *   - exact task type (SOURCE_FETCH or SOURCE_DISCOVERY only)
 *   - userId (non-empty, <=128 chars, no control chars)
 *   - 60-second UTC time bucket (suppresses double-click / retry)
 *
 * Same type + user + UTC minute -> same key.
 * Different type / user / minute -> different key.
 * Total key length <= 200.
 *
 * The key never contains URLs, secrets, or arbitrary form input.
 */
export function buildManualTaskRunIdempotencyKey(
  input: ManualIdempotencyKeyInput,
): string {
  const type = input.type;
  if (!ALLOWED_MANUAL_TYPES.has(type)) {
    throw new Error(`type must be SOURCE_FETCH or SOURCE_DISCOVERY (got ${type}).`);
  }

  const userId = input.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("userId must not be blank.");
  }
  if (userId.length > MAX_USER_ID_LENGTH) {
    throw new Error(
      `userId length must be <= ${MAX_USER_ID_LENGTH} (got ${userId.length}).`,
    );
  }
  if (CONTROL_CHARS.test(userId)) {
    throw new Error("userId must not contain control characters.");
  }

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("now must be a valid Date.");
  }

  // UTC 60-second time bucket: floor to the current minute.
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const bucket = `${year}${month}${day}T${hours}${minutes}`;

  const key = `manual:${type}:${userId}:${bucket}`;
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(
      `idempotencyKey length must be <= ${MAX_KEY_LENGTH} (got ${key.length}).`,
    );
  }
  return key;
}
