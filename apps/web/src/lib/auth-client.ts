import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient();

export type { Session, User } from "better-auth";
