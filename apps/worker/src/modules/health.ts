import { getPrismaClient } from "@wangchao/db";
import type { WorkerHealthCheckResult } from "./types.js";

async function checkWorkerDatabase(): Promise<{
  message?: string;
  status: "ok" | "down" | "skipped";
}> {
  if (!process.env.DATABASE_URL) {
    return {
      message: "Database connection is not configured.",
      status: "skipped",
    };
  }

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "down",
    };
  }
}

export async function runWorkerHealthCheck(): Promise<WorkerHealthCheckResult> {
  const database = await checkWorkerDatabase();
  const status = database.status === "down" ? "degraded" : "ok";

  return {
    checks: {
      database,
    },
    generatedAt: new Date().toISOString(),
    service: "wangchao-worker",
    status,
  };
}
