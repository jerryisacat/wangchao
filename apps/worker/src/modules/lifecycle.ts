import { getSoftTimeoutMs } from "./env.js";

let isShuttingDown = false;
let cycleStartTime = Date.now();

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

export function resetCycleStartTime(): void {
  cycleStartTime = Date.now();
}

export function isCycleTimeExhausted(): boolean {
  return Date.now() - cycleStartTime > getSoftTimeoutMs();
}
