import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  prisma ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: readRequiredRuntimeEnv("DATABASE_URL"),
    }),
  });
  return prisma;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = undefined;
}

function readRequiredRuntimeEnv(key: string): string {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const value = runtime.process?.env?.[key];

  if (!value) {
    throw new Error(`${key} is required to initialize Prisma Client.`);
  }

  return value;
}
