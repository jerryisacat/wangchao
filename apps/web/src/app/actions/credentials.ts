"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { defaultAiBaseUrl } from "../admin/settings/providers";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readOptionalField,
  toUserActionError,
} from "./_shared";

export async function upsertAiCredentialAction(formData: FormData): Promise<void> {
  let message = "AI 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      throw new Error("AI_API_KEY_MISSING");
    }
    const baseUrl = readOptionalField(formData, "aiBaseUrl");
    const provider = readOptionalField(formData, "aiProvider");
    const model = readOptionalField(formData, "aiModel");

    if (baseUrl) {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("AI_BASE_URL_INVALID");
      }
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await upsertAiCredential(prisma, { organizationId: workspace.organizationId }, {
      apiKey,
      baseUrl: baseUrl || undefined,
      provider: provider || undefined,
      model: model || undefined,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertAiCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function upsertSearchCredentialAction(formData: FormData): Promise<void> {
  let message = "搜索凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "searchApiKey");
    if (!apiKey) {
      throw new Error("SEARCH_API_KEY_MISSING");
    }
    const provider = readOptionalField(formData, "searchProvider");

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertSearchCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await upsertSearchCredential(prisma, { organizationId: workspace.organizationId }, {
      apiKey,
      provider: provider || "brave",
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertSearchCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteAiCredentialAction(formData: FormData): Promise<void> {
  let message = "AI 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteAiCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await deleteAiCredential(prisma, { organizationId: workspace.organizationId });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteAiCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteSearchCredentialAction(formData: FormData): Promise<void> {
  let message = "搜索凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteSearchCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await deleteSearchCredential(prisma, { organizationId: workspace.organizationId });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteSearchCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testAiCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      return { message: "请输入 AI API Key 后再测试。", ok: false };
    }
    const provider = readOptionalField(formData, "aiProvider");
    const baseUrl = readOptionalField(formData, "aiBaseUrl") || defaultAiBaseUrl(provider);
    if (!baseUrl) {
      return { message: "请填写 AI Provider 的 Base URL 后再测试。", ok: false };
    }
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { message: "请输入有效的 HTTP 或 HTTPS Base URL。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return testAiCredential({ apiKey, baseUrl });
  } catch (error) {
    logActionError("testAiCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function listAiModelsAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string; models: Array<{ id: string; ownedBy?: string }> }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to list models.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      return { ok: false, message: "请输入 AI API Key 后再获取模型列表。", models: [] };
    }
    const provider = readOptionalField(formData, "aiProvider");
    const baseUrl = readOptionalField(formData, "aiBaseUrl") || defaultAiBaseUrl(provider);
    if (!baseUrl) {
      return { ok: false, message: "请填写 AI Provider 的 Base URL 后再获取模型列表。", models: [] };
    }
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, message: "请输入有效的 HTTP 或 HTTPS Base URL。", models: [] };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      listAiModels,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return listAiModels({ apiKey, baseUrl });
  } catch (error) {
    logActionError("listAiModelsAction", error);
    return { ok: false, message: toUserActionError(error), models: [] };
  }
}

export async function testSearchCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "searchApiKey");
    if (!apiKey) {
      return { message: "请输入搜索 API Key 后再测试。", ok: false };
    }
    const provider = readOptionalField(formData, "searchProvider") || "brave";

    const {
      assertMembershipRole,
      getPrismaClient,
      testSearchCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return testSearchCredential({ apiKey, provider });
  } catch (error) {
    logActionError("testSearchCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function upsertTelegramCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "Telegram 投递凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const botToken = readOptionalField(formData, "telegramBotToken");
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
    }
    const chatId = readOptionalField(formData, "telegramChatId");
    if (!chatId) {
      throw new Error("TELEGRAM_CHAT_ID_MISSING");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertTelegramCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await upsertTelegramCredential(
      prisma,
      { organizationId: workspace.organizationId },
      { botToken, chatId, enabled: true },
    );

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-telegram" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertTelegramCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteTelegramCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "Telegram 投递凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteTelegramCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await deleteTelegramCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-telegram" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteTelegramCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testTelegramCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const botToken = readOptionalField(formData, "telegramBotToken");
    if (!botToken) {
      return { message: "请输入 Bot Token 后再测试。", ok: false };
    }
    const chatId = readOptionalField(formData, "telegramChatId");
    if (!chatId) {
      return { message: "请输入 Chat ID 后再测试。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testTelegramCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return testTelegramCredential({ botToken, chatId });
  } catch (error) {
    logActionError("testTelegramCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function upsertCcpaymentCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "CCPayment 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const appId = readOptionalField(formData, "ccpaymentAppId");
    if (!appId) {
      throw new Error("CCPAYMENT_APP_ID_MISSING");
    }
    const appSecret = readOptionalField(formData, "ccpaymentAppSecret");
    if (!appSecret) {
      throw new Error("CCPAYMENT_APP_SECRET_MISSING");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertCcpaymentCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await upsertCcpaymentCredential(
      prisma,
      { organizationId: workspace.organizationId },
      { appId, appSecret },
    );

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-ccpayment" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertCcpaymentCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteCcpaymentCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "CCPayment 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteCcpaymentCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    await deleteCcpaymentCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-ccpayment" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteCcpaymentCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testCcpaymentCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const appId = readOptionalField(formData, "ccpaymentAppId");
    if (!appId) {
      return { message: "请输入 CCPayment App ID 后再测试。", ok: false };
    }
    const appSecret = readOptionalField(formData, "ccpaymentAppSecret");
    if (!appSecret) {
      return { message: "请输入 CCPayment App Secret 后再测试。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testCcpaymentCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return testCcpaymentCredential({ appId, appSecret });
  } catch (error) {
    logActionError("testCcpaymentCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function upsertByokCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "BYOK 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "byokApiKey");
    if (!apiKey) {
      throw new Error("BYOK_API_KEY_MISSING");
    }
    const baseUrl = readOptionalField(formData, "byokBaseUrl");
    if (!baseUrl) {
      throw new Error("BYOK_BASE_URL_MISSING");
    }
    const provider = readOptionalField(formData, "byokProvider");
    const model = readOptionalField(formData, "byokModel");

    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("AI_BASE_URL_INVALID");
    }

    const {
      assertMembershipRole,
      encryptCredential,
      getPrismaClient,
      maskKeyHint,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    const { upsertByokCredential } = await import("@wangchao/db");
    await upsertByokCredential(prisma, {
      organizationId: workspace.organizationId,
    }, {
      apiKey,
      baseUrl,
      provider: provider || undefined,
      model: model || undefined,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-byok" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertByokCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteByokCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "BYOK 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    const { deleteByokCredential } = await import("@wangchao/db");
    await deleteByokCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-byok" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteByokCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testByokCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "byokApiKey");
    if (!apiKey) {
      return { message: "请输入 BYOK API Key 后再测试。", ok: false };
    }
    const baseUrl = readOptionalField(formData, "byokBaseUrl");
    if (!baseUrl) {
      return { message: "请填写 Base URL 后再测试。", ok: false };
    }

    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { message: "请输入有效的 HTTP 或 HTTPS Base URL。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    return testAiCredential({ apiKey, baseUrl });
  } catch (error) {
    logActionError("testByokCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}
