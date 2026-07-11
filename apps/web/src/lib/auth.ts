import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

export function isAuthEnabled(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

let _auth: ReturnType<typeof createAuth> | null = null;

function createAuth() {
  const { getPrismaClient } = require("@wangchao/db") as typeof import("@wangchao/db");
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
    user: {
      additionalFields: {
        emailVerified: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        image: {
          type: "string",
          required: false,
        },
      },
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
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}
