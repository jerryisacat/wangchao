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

const FALLBACK_TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramCredentialView {
  hasBotToken: boolean;
  botTokenHint: string | null;
  chatId: string | null;
  enabled: boolean;
}

export interface DecryptedTelegramCredential {
  botToken: string;
  chatId: string;
}

export async function getTelegramCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<TelegramCredentialView> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "TELEGRAM",
      },
    },
    select: {
      encryptedKey: true,
      keyHint: true,
      chatId: true,
      enabled: true,
    },
  });

  if (!cred) {
    return { hasBotToken: false, botTokenHint: null, chatId: null, enabled: false };
  }

  return {
    hasBotToken: Boolean(cred.encryptedKey),
    botTokenHint: cred.keyHint,
    chatId: cred.chatId,
    enabled: cred.enabled,
  };
}

export async function upsertTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { botToken: string; chatId: string; enabled?: boolean },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedToken = encryptCredential(input.botToken, encryptionKey);
  const tokenHint = maskKeyHint(input.botToken);

  await prisma.organizationCredential.upsert({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "TELEGRAM",
      },
    },
    update: {
      encryptedKey: encryptedToken,
      keyHint: tokenHint,
      chatId: input.chatId,
      enabled: input.enabled ?? true,
    },
    create: {
      organizationId: scope.organizationId,
      credentialType: "TELEGRAM",
      encryptedKey: encryptedToken,
      keyHint: tokenHint,
      chatId: input.chatId,
      enabled: input.enabled ?? true,
    },
  });
}

export async function setTelegramEnabled(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<void> {
  const existing = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "TELEGRAM",
      },
    },
    select: { id: true },
  });

  if (!existing) {
    return;
  }

  await prisma.organizationCredential.update({
    where: { id: existing.id },
    data: { enabled },
  });
}

export async function deleteTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.organizationCredential.deleteMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: "TELEGRAM",
    },
  });
}

export async function getDecryptedTelegramCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedTelegramCredential | null> {
  const cred = await prisma.organizationCredential.findUnique({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "TELEGRAM",
      },
    },
    select: {
      encryptedKey: true,
      chatId: true,
      enabled: true,
    },
  });

  if (!cred || !cred.enabled) {
    return null;
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");
  if (!cred.encryptedKey || !cred.chatId) {
    return null;
  }
  if (!encryptionKey) {
    return null;
  }

  try {
    const botToken = decryptCredential(cred.encryptedKey, encryptionKey);
    return { botToken, chatId: cred.chatId };
  } catch {
    return null;
  }
}

export async function testTelegramCredential(input: {
  botToken: string;
  chatId: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = process.env.TELEGRAM_API_BASE ?? FALLBACK_TELEGRAM_API_BASE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${base}/bot${input.botToken}/getMe`, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `Bot Token 验证失败：HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const body = (await response.json()) as { ok?: boolean; description?: string };
    if (!body.ok) {
      return {
        ok: false,
        message: body.description ?? "Bot Token 无效。",
      };
    }

    const chatCheck = await fetch(
      `${base}/bot${input.botToken}/getChat?chat_id=${encodeURIComponent(input.chatId)}`,
      { method: "GET", signal: controller.signal },
    );

    if (chatCheck.ok) {
      return { ok: true, message: "Telegram Bot Token 和 Chat ID 验证成功。" };
    }

    const chatBody = (await chatCheck.json().catch(() => null)) as {
      description?: string;
    } | null;
    return {
      ok: false,
      message: `Bot Token 有效，但 Chat ID 验证失败：${chatBody?.description ?? `HTTP ${chatCheck.status}`}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "Telegram API 连接超时，请检查网络。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
