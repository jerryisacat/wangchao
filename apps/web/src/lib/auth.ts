import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import {
  assertDeploymentConfiguration,
  getDeploymentConfiguration,
} from "@/lib/deployment-mode";

export function isAuthEnabled(): boolean {
  return getDeploymentConfiguration().authEnabled;
}

let authPromise: ReturnType<typeof createAuth> | null = null;

async function createAuth() {
  assertDeploymentConfiguration();
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error("AUTH_SECRET_MISSING");
  }
  const { getPrismaClient } = await import("@wangchao/db");
  return betterAuth({
    appName: "望潮 Wangchao",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    database: prismaAdapter(getPrismaClient(), {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    account: {
      fields: {
        accessTokenExpiresAt: "expiresAt",
      },
    },
    plugins: [nextCookies()],
  });
}

export function getAuth() {
  if (!authPromise) {
    authPromise = createAuth().catch((error: unknown) => {
      authPromise = null;
      throw error;
    });
  }
  return authPromise;
}
