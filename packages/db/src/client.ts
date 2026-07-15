import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { readRequiredRuntimeEnv } from "./repositories/util.js";

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
