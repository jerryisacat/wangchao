import { getDeploymentConfiguration } from "@/lib/deployment-mode";

export async function GET() {
  const generatedAt = new Date();
  const checks: Record<string, HealthCheck> = {
    authentication: checkAuthentication(),
    database: await checkDatabase(),
  };
  const status = Object.values(checks).some((check) => check.status === "down")
    ? "degraded"
    : "ok";

  return Response.json(
    {
      checks,
      generatedAt: generatedAt.toISOString(),
      service: "wangchao-web",
      status,
    },
    {
      status: status === "ok" ? 200 : 503,
    },
  );
}

function checkAuthentication(): HealthCheck {
  const configuration = getDeploymentConfiguration();
  if (!configuration.ready) {
    return {
      message: "Commercial authentication is not configured safely.",
      status: "down",
    };
  }
  if (!configuration.authEnabled) {
    return {
      message: "Authentication is disabled in self-hosted mode.",
      status: "skipped",
    };
  }
  return { status: "ok" };
}

interface HealthCheck {
  message?: string;
  status: "ok" | "down" | "skipped";
}

async function checkDatabase(): Promise<HealthCheck> {
  if (!process.env.DATABASE_URL) {
    return {
      message: "Database connection is not configured.",
      status: "skipped",
    };
  }

  try {
    const { getPrismaClient } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    process.stderr.write(
      `Health check database error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return {
      message: "Database connection failed.",
      status: "down",
    };
  }
}
