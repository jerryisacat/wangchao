export function readPositiveIntegerEnv(key: string, fallback: number): number {
  const value = Number.parseInt(readRawEnv(key) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readFloatEnv(key: string, fallback: number): number {
  const value = Number.parseFloat(readRawEnv(key) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

export function readBoundedNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(readRawEnv(name));
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function readRawEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[key];
}
