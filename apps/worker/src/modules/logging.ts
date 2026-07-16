export interface StructuredLogStart {
  event: "cycle-start";
  cycle: string;
  timestamp: string;
}

export interface StructuredLogEnd {
  event: "cycle-end";
  cycle: string;
  timestamp: string;
  durationMs: number;
  status: "ok" | "degraded" | "error";
  [key: string]: unknown;
}

export function emitStructuredLogStart(cycle: string): number {
  const log = {
    cycle,
    event: "cycle-start",
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
  return Date.now();
}

export function emitStructuredLogEnd(
  cycle: string,
  startTime: number,
  status: "ok" | "degraded" | "error",
  metrics: Record<string, unknown>,
): void {
  const log = {
    cycle,
    durationMs: Date.now() - startTime,
    event: "cycle-end",
    status,
    timestamp: new Date().toISOString(),
    ...metrics,
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
}
