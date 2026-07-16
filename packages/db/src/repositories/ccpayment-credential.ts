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

export interface CcpaymentCredentialView {
  hasSecret: boolean;
  secretHint: string | null;
  appId: string | null;
}

export async function getCcpaymentCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<CcpaymentCredentialView> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "CCPAYMENT",
      },
    },
    select: {
      appId: true,
      encryptedSecret: true,
      keyHint: true,
    },
  });

  if (!cred) {
    return { hasSecret: false, secretHint: null, appId: null };
  }

  return {
    hasSecret: Boolean(cred.encryptedSecret),
    secretHint: cred.keyHint,
    appId: cred.appId,
  };
}

export async function upsertCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { appId: string; appSecret: string },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedSecret = encryptCredential(input.appSecret, encryptionKey);
  const secretHint = maskKeyHint(input.appSecret);

  await prisma.organizationCredential.upsert({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "CCPAYMENT",
      },
    },
    update: {
      appId: input.appId,
      encryptedSecret,
      keyHint: secretHint,
    },
    create: {
      organizationId: scope.organizationId,
      credentialType: "CCPAYMENT",
      appId: input.appId,
      encryptedSecret,
      keyHint: secretHint,
    },
  });
}

export async function deleteCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.organizationCredential.deleteMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: "CCPAYMENT",
    },
  });
}

export async function getDecryptedCcpaymentCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<{ appId: string; appSecret: string } | null> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "CCPAYMENT",
      },
    },
    select: {
      appId: true,
      encryptedSecret: true,
    },
  });

  if (!cred || !cred.appId || !cred.encryptedSecret) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!encryptionKey) {
    return null;
  }

  try {
    const appSecret = decryptCredential(cred.encryptedSecret, encryptionKey);
    return { appId: cred.appId, appSecret };
  } catch {
    return null;
  }
}
