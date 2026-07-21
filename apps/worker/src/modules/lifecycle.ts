import { getSoftTimeoutMs } from "./env.js";

let isShuttingDown = false;
let cycleDeadline = Date.now() + getSoftTimeoutMs();

export function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[worker] Received ${signal}, shutting down gracefully...`);
    setTimeout(() => {
      console.log("[worker] Forced exit after grace period");
      process.exit(0);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export function markShuttingDown(): void {
  isShuttingDown = true;
}

export function isCycleShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Set the cycle time budget. When `timeoutMs` is omitted the default soft
 * timeout (`WANGCHAO_WORKER_CYCLE_SOFT_TIMEOUT_MS`) is used. The deadline is
 * stored locally as an absolute timestamp; `isCycleTimeExhausted` returns true
 * once `Date.now()` reaches it.
 */
export function resetCycleTimeBudget(timeoutMs?: number): void {
  const budget = timeoutMs ?? getSoftTimeoutMs();
  cycleDeadline = Date.now() + budget;
}

/**
 * Backward-compatible alias: resets the cycle start time using the default
 * budget (same behavior as pre-#163 `resetCycleStartTime`).
 */
export function resetCycleStartTime(): void {
  resetCycleTimeBudget();
}

/**
 * Remaining milliseconds until the cycle deadline. Never negative.
 */
export function getCycleRemainingMs(): number {
  return Math.max(0, cycleDeadline - Date.now());
}

/**
 * Deadline semantics: true once `Date.now()` reaches the cycle deadline.
 */
export function isCycleTimeExhausted(): boolean {
  return Date.now() >= cycleDeadline;
}