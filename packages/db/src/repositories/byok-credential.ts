import type { PrismaClient } from "@prisma/client";
import {
  decryptCredential,
  encryptCredential,
  maskKeyHint,
} from "../crypto.js";
import {
  readRequiredRuntimeEnv,
  readRuntimeEnv,
} from "./util.js";
import type { TenantScope } from "./types.js";

export interface ByokCredentialView {
  hasKey: boolean;
  keyHint: string | null;
  baseUrl: string | null;
  provider: string | null;
  model: string | null;
}

export interface DecryptedByokCredential {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function getByokCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<ByokCredentialView> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "BYOK",
      },
    },
    select: {
      encryptedKey: true,
      keyHint: true,
      baseUrl: true,
      provider: true,
      model: true,
    },
  });

  if (!cred) {
    return {
      hasKey: false,
      keyHint: null,
      baseUrl: null,
      provider: null,
      model: null,
    };
  }

  return {
    hasKey: Boolean(cred.encryptedKey),
    keyHint: cred.keyHint,
    baseUrl: cred.baseUrl,
    provider: cred.provider,
    model: cred.model,
  };
}

export async function upsertByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    apiKey: string;
    baseUrl?: string;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedKey = encryptCredential(input.apiKey, encryptionKey);
  const keyHint = maskKeyHint(input.apiKey);

  await prisma.organizationCredential.upsert({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "BYOK",
      },
    },
    update: {
      encryptedKey,
      keyHint,
      baseUrl: input.baseUrl ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
    },
    create: {
      organizationId: scope.organizationId,
      credentialType: "BYOK",
      encryptedKey,
      keyHint,
      baseUrl: input.baseUrl ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
    },
  });
}

export async function deleteByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.organizationCredential.deleteMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: "BYOK",
    },
  });
}

export async function getDecryptedByokCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedByokCredential | null> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "BYOK",
      },
    },
    select: {
      encryptedKey: true,
      baseUrl: true,
      model: true,
    },
  });

  if (!cred || !cred.encryptedKey) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!encryptionKey) {
    return null;
  }

  try {
    const apiKey = decryptCredential(cred.encryptedKey, encryptionKey);
    return {
      apiKey,
      baseUrl: cred.baseUrl ?? "",
      model: cred.model ?? "gpt-4o-mini",
    };
  } catch {
    return null;
  }
}
