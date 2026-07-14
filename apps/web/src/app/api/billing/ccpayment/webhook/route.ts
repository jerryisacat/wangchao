import {
  getCcpaymentOrderInfo,
  getPrismaClient,
  updatePaymentInvoiceStatus,
  verifyCcpaymentWebhookSignature,
  findPaymentInvoiceByOrderId,
} from "@wangchao/db";

interface WebhookPayload {
  recordId?: string;
  orderId?: string;
  orderStatus?: string;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return new Response("Database not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const appId = request.headers.get("Appid") ?? "";
  const timestamp = request.headers.get("Timestamp") ?? "";
  const signature = request.headers.get("Sign") ?? "";

  if (!appId || !timestamp || !signature) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const prisma = getPrismaClient();

  const credential = await resolveCredential(prisma, appId);
  if (!credential) {
    return new Response("Unknown appId", { status: 401 });
  }

  const valid = verifyCcpaymentWebhookSignature(
    { appId: credential.appId, appSecret: credential.appSecret },
    timestamp,
    rawBody,
    signature,
  );
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const recordId = payload.recordId;
  const orderId = payload.orderId;
  if (!recordId || !orderId) {
    return webhookSuccess();
  }

  const alreadyProcessed = await isRecordIdProcessed(prisma, recordId);
  if (alreadyProcessed) {
    return webhookSuccess();
  }

  try {
    const orderInfo = await getCcpaymentOrderInfo(credential, orderId);

    const invoice = await findPaymentInvoiceByOrderId(prisma, "ccpayment", credential.organizationId, orderId);
    if (!invoice) {
      return webhookSuccess();
    }

    const confirmed =
      orderInfo.status === "Success" && !orderInfo.isFlaggedAsRisky;

    if (confirmed && invoice.status !== "PAID") {
      await markInvoicePaidAndActivateSubscription(prisma, invoice, orderInfo);
    } else if (orderInfo.status === "Failed") {
      await updatePaymentInvoiceStatus(
        prisma,
        invoice.id,
        "FAILED",
        {
          webhookRecordId: recordId,
          orderStatus: orderInfo.status,
          isFlaggedAsRisky: orderInfo.isFlaggedAsRisky,
        },
      );
    } else {
      await updatePaymentInvoiceStatus(
        prisma,
        invoice.id,
        invoice.status === "PAID" ? "PAID" : "PENDING",
        {
          webhookRecordId: recordId,
          orderStatus: orderInfo.status,
          isFlaggedAsRisky: orderInfo.isFlaggedAsRisky,
        },
      );
    }

    await markRecordIdProcessed(prisma, recordId, invoice.id);
  } catch (error) {
    process.stderr.write(
      `[ccpayment-webhook] ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return webhookSuccess();
}

async function resolveCredential(
  prisma: ReturnType<typeof getPrismaClient>,
  appId: string,
): Promise<{ appId: string; appSecret: string; organizationId: string } | null> {
  const cred = await prisma.organizationCredential.findFirst({
    where: {
      appId,
      credentialType: "CCPAYMENT",
    },
    select: {
      appId: true,
      encryptedSecret: true,
      organizationId: true,
    },
  });

  if (cred?.appId === appId && cred.encryptedSecret) {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) return null;
    try {
      const { decryptCredential } = await import("@wangchao/db");
      const appSecret = decryptCredential(cred.encryptedSecret, encryptionKey);
      return { appId: cred.appId, appSecret, organizationId: cred.organizationId };
    } catch {
      return null;
    }
  }

  return null;
}

async function isRecordIdProcessed(
  prisma: ReturnType<typeof getPrismaClient>,
  recordId: string,
): Promise<boolean> {
  const existing = await prisma.paymentInvoice.findFirst({
    where: {
      metadata: { path: ["ccpaymentWebhookRecordIds"], array_contains: recordId },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function markRecordIdProcessed(
  prisma: ReturnType<typeof getPrismaClient>,
  recordId: string,
  invoiceId: string | null,
): Promise<void> {
  if (!invoiceId) return;
  const invoice = await prisma.paymentInvoice.findUnique({
    where: { id: invoiceId },
    select: { metadata: true },
  });

  const currentMeta =
    invoice?.metadata !== null &&
    typeof invoice?.metadata === "object" &&
    !Array.isArray(invoice?.metadata)
      ? { ...(invoice!.metadata as Record<string, unknown>) }
      : {};

  const existingIds = Array.isArray(currentMeta.ccpaymentWebhookRecordIds)
    ? (currentMeta.ccpaymentWebhookRecordIds as unknown[])
    : [];

  if (!existingIds.includes(recordId)) {
    existingIds.push(recordId);
  }

  currentMeta.ccpaymentWebhookRecordIds = existingIds;
  currentMeta.lastWebhookRecordId = recordId;
  currentMeta.lastWebhookAt = new Date().toISOString();

  await prisma.paymentInvoice.update({
    where: { id: invoiceId },
    data: { metadata: currentMeta as never },
  });
}

async function markInvoicePaidAndActivateSubscription(
  prisma: ReturnType<typeof getPrismaClient>,
  invoice: {
    id: string;
    organizationId: string;
    plan: "FREE" | "PLUS" | "PRO";
    periodStart: string | null;
    periodEnd: string | null;
  },
  orderInfo: { status: string; isFlaggedAsRisky: boolean; amount: number },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.paymentInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        metadata: {
          paidAt: new Date().toISOString(),
          orderStatus: orderInfo.status,
          isFlaggedAsRisky: orderInfo.isFlaggedAsRisky,
        },
      },
    });

    const periodStart = invoice.periodStart ? new Date(invoice.periodStart) : new Date();
    const periodEnd = invoice.periodEnd ? new Date(invoice.periodEnd) : undefined;

    await tx.subscription.upsert({
      where: { organizationId: invoice.organizationId },
      update: {
        plan: invoice.plan,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      create: {
        organizationId: invoice.organizationId,
        plan: invoice.plan,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
  });
}

function webhookSuccess(): Response {
  return new Response("Success", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
