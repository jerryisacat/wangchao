import type { QuotaCheckResult } from "./quota.js";

export class QuotaExceededError extends Error {
  readonly reason: string;
  readonly upgradeHint?: string;
  readonly currentUsage?: number;
  readonly limit?: number | null;

  constructor(result: QuotaCheckResult) {
    super(result.reason ?? "Quota limit reached.");
    this.name = "QuotaExceededError";
    this.reason = result.reason ?? "Quota limit reached.";
    this.upgradeHint = result.upgradeHint;
    this.currentUsage = result.currentUsage;
    this.limit = result.limit;
  }
}

export function assertQuotaAllowed(result: QuotaCheckResult): void {
  if (!result.allowed) {
    throw new QuotaExceededError(result);
  }
}

export interface QuotaGuardContext<TInput> {
  input: TInput;
  check: (input: TInput) => Promise<QuotaCheckResult> | QuotaCheckResult;
}

export async function withQuotaGuard<TInput, TResult>(
  context: QuotaGuardContext<TInput>,
  action: (input: TInput) => Promise<TResult>,
): Promise<TResult> {
  const result = await context.check(context.input);
  assertQuotaAllowed(result);
  return action(context.input);
}
