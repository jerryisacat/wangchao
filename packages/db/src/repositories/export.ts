import type { Prisma, PrismaClient } from "@prisma/client";
import { readRequiredRuntimeEnv, toInputJson } from "./util.js";
import { decryptCredential, encryptCredential, maskKeyHint } from "../crypto.js";
import type {
  AiCredentialTestInput,
  AiModelListInput,
  AiModelListResult,
  CredentialTestResult,
  DecryptedAiCredential,
  DecryptedCredentials,
  DecryptedSearchCredential,
  RecordMarkdownExportInput,
  RecordUsageEventInput,
  SearchCredentialTestInput,
  SubscriptionCredentialView,
  TenantScope,
  UsageSummaryRecord,
} from "./types.js";

export async function recordMarkdownExport(
  prisma: PrismaClient,
  input: RecordMarkdownExportInput,
) {
  const format = input.format ?? "MARKDOWN";
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.exportEvent.create({
      data: {
        organizationId: input.organizationId,
        topicId: input.topicId,
        userId: input.userId,
        eventId: input.eventId,
        briefingId: input.briefingId,
        format,
        fileName: input.fileName,
        contentHash: input.contentHash,
        metadata: toInputJson(input.metadata),
      },
    }),
  ];

  if (input.eventId && input.userId) {
    operations.push(
      prisma.feedbackEvent.create({
        data: {
          organizationId: input.organizationId,
          topicId: input.topicId,
          userId: input.userId,
          eventId: input.eventId,
          kind: "EXPORT",
          value: 2,
          metadata: {
            fileName: input.fileName,
            format,
            source: "export-route",
          },
        },
      }),
    );
  }

  await prisma.$transaction(operations);
}

export async function recordUsageEvent(
  prisma: PrismaClient,
  input: RecordUsageEventInput,
) {
  return prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      quantity: input.quantity ?? 1,
      unit: input.unit,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: toInputJson(input.metadata),
    },
  });
}

export async function listUsageSummary(
  prisma: PrismaClient,
  scope: TenantScope,
  since?: Date,
): Promise<UsageSummaryRecord[]> {
  const events = await prisma.usageEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      createdAt: since ? { gte: since } : undefined,
    },
    select: {
      quantity: true,
      type: true,
      unit: true,
    },
  });
  const grouped = new Map<string, UsageSummaryRecord>();

  for (const event of events) {
    const key = `${event.type}:${event.unit}`;
    const existing = grouped.get(key) ?? {
      count: 0,
      quantity: 0,
      type: event.type as UsageSummaryRecord["type"],
      unit: event.unit,
    };
    existing.count += 1;
    existing.quantity += event.quantity;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.type.localeCompare(right.type),
  );
}

export async function getSubscriptionCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SubscriptionCredentialView | null> {
  const credentials = await prisma.organizationCredential.findMany({
    where: { organizationId: scope.organizationId },
    select: {
      credentialType: true,
      encryptedKey: true,
      keyHint: true,
      baseUrl: true,
      provider: true,
      model: true,
      updatedAt: true,
    },
  });

  if (credentials.length === 0) {
    return null;
  }

  let ai: SubscriptionCredentialView["ai"] | null = null;
  let search: SubscriptionCredentialView["search"] | null = null;
  let latestUpdate: Date | null = null;

  for (const cred of credentials) {
    if (cred.updatedAt && (!latestUpdate || cred.updatedAt > latestUpdate)) {
      latestUpdate = cred.updatedAt;
    }
    if (cred.credentialType === "AI") {
      ai = {
        hasKey: Boolean(cred.encryptedKey),
        keyHint: cred.keyHint,
        baseUrl: cred.baseUrl,
        provider: cred.provider,
        model: cred.model,
      };
    } else if (cred.credentialType === "SEARCH") {
      search = {
        hasKey: Boolean(cred.encryptedKey),
        keyHint: cred.keyHint,
        provider: cred.provider,
      };
    }
  }

  return {
    ai: ai ?? { hasKey: false, keyHint: null, baseUrl: null, provider: null, model: null },
    search: search ?? { hasKey: false, keyHint: null, provider: null },
    updatedAt: latestUpdate ?? new Date(),
  };
}

export async function upsertAiCredential(
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
        credentialType: "AI",
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
      credentialType: "AI",
      encryptedKey,
      keyHint,
      baseUrl: input.baseUrl ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
    },
  });
}

export async function upsertSearchCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    apiKey: string;
    provider?: string;
  },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedKey = encryptCredential(input.apiKey, encryptionKey);
  const keyHint = maskKeyHint(input.apiKey);

  await prisma.organizationCredential.upsert({
    where: {
      organizationId_credentialType: {
        organizationId: scope.organizationId,
        credentialType: "SEARCH",
      },
    },
    update: {
      encryptedKey,
      keyHint,
      provider: input.provider ?? null,
    },
    create: {
      organizationId: scope.organizationId,
      credentialType: "SEARCH",
      encryptedKey,
      keyHint,
      provider: input.provider ?? null,
    },
  });
}

export async function deleteAiCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.organizationCredential.deleteMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: "AI",
    },
  });
}

export async function deleteSearchCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.organizationCredential.deleteMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: "SEARCH",
    },
  });
}

export async function testAiCredential(
  credential: AiCredentialTestInput,
): Promise<CredentialTestResult> {
  const baseUrl = credential.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${credential.apiKey}` },
      method: "GET",
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, message: "AI 凭证连接测试成功。" };
    }

    if (isModelsEndpointUnavailable(response.status)) {
      return probeChatCompletions(baseUrl, credential.apiKey, controller.signal);
    }

    return {
      ok: false,
      message: `连接失败：HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return probeChatCompletions(baseUrl, credential.apiKey, controller.signal);
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeChatCompletions(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<CredentialTestResult> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
        model: "gpt-4o-mini",
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    });

    if (response.ok) {
      return { ok: true, message: "AI 凭证连接测试成功（通过 chat/completions 端点）。" };
    }
    return {
      ok: false,
      message: `连接失败（chat/completions）：HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "连接超时，请检查 Base URL 是否正确。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isModelsEndpointUnavailable(status: number): boolean {
  return status === 404 || status === 405 || status === 415 || status === 501;
}

export async function listAiModels(
  credential: AiModelListInput,
): Promise<AiModelListResult> {
  const baseUrl = credential.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${credential.apiKey}` },
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `无法获取模型列表：HTTP ${response.status} ${response.statusText}`.trim(),
        models: [],
      };
    }

    const raw = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
    const models = (raw.data ?? [])
      .map((m) => ({ id: m.id, ownedBy: m.owned_by }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) {
      return { ok: false, message: "端点返回了空模型列表。", models: [] };
    }

    return { ok: true, message: `已发现 ${models.length} 个可用模型。`, models };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "获取模型列表超时，请检查 Base URL 是否正确。", models: [] };
    }
    return {
      ok: false,
      message: `获取模型列表错误：${error instanceof Error ? error.message : String(error)}`,
      models: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testSearchCredential(
  credential: SearchCredentialTestInput,
): Promise<CredentialTestResult> {
  const { apiKey, provider } = credential;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    let response: Response;

    if (provider === "brave") {
      response = await fetch(
        "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
        {
          headers: { "X-Subscription-Token": apiKey },
          method: "GET",
          signal: controller.signal,
        },
      );
    } else if (provider === "serpapi") {
      response = await fetch(
        `https://serpapi.com/search?api_key=${encodeURIComponent(apiKey)}&q=test&num=1`,
        { method: "GET", signal: controller.signal },
      );
    } else if (provider === "tavily") {
      response = await fetch("https://api.tavily.com/search", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          api_key: apiKey,
          query: "test",
          max_results: 1,
        }),
        signal: controller.signal,
      });
    } else {
      return {
        ok: false,
        message: `暂不支持对 "${provider}" 进行自动连接测试，请手动验证 API Key。`,
      };
    }

    if (response.ok) {
      return { ok: true, message: "搜索凭证连接测试成功。" };
    }
    return {
      ok: false,
      message: `连接失败：HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "连接超时，请检查网络或 Provider 设置是否正确。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDecryptedCredentials(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedCredentials | null> {
  const credentials = await prisma.organizationCredential.findMany({
    where: {
      organizationId: scope.organizationId,
      credentialType: { in: ["AI", "SEARCH"] },
    },
    select: {
      credentialType: true,
      encryptedKey: true,
      baseUrl: true,
      model: true,
      provider: true,
    },
  });

  const aiCred = credentials.find((c) => c.credentialType === "AI");
  const searchCred = credentials.find((c) => c.credentialType === "SEARCH");

  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");

  let ai: DecryptedAiCredential | null = null;
  if (aiCred?.encryptedKey && aiCred.baseUrl && encryptionKey) {
    try {
      const apiKey = decryptCredential(aiCred.encryptedKey, encryptionKey);
      ai = {
        apiKey,
        baseUrl: aiCred.baseUrl,
        model: aiCred.model ?? "gpt-4o-mini",
      };
    } catch {
      // Decryption failure -> treat as no credential
    }
  }

  let search: DecryptedSearchCredential | null = null;
  if (searchCred?.encryptedKey && encryptionKey) {
    try {
      const apiKey = decryptCredential(searchCred.encryptedKey, encryptionKey);
      search = {
        apiKey,
        baseUrl: searchCred.baseUrl ?? null,
        provider: searchCred.provider ?? "brave",
      };
    } catch {
      // Decryption failure -> treat as no credential
    }
  }

  return { ai, search };
}
