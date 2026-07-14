import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { getSessionWorkspace } from "@/lib/session";
import {
  assertMembershipRole,
  createCcpaymentInvoice,
  createPaymentInvoice,
  getDecryptedCcpaymentCredential,
  getPrismaClient,
  recordUsageEvent,
  type CcpaymentConfig,
} from "@wangchao/db";
import { PLAN_REGISTRY } from "@wangchao/core";

const PLAN_PRICING = {
  PLUS: {
    amount: PLAN_REGISTRY.PLUS.pricing.yearlyPriceUsd ?? 9.99,
    label: "$9.99/year",
    months: 12,
  },
  PRO: {
    amount: PLAN_REGISTRY.PRO.pricing.monthlyPriceUsd ?? 19.99,
    label: "$19.99/month",
    months: 1,
  },
} as const;

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 },
    );
  }

  let body: { plan?: string };
  try {
    body = (await request.json()) as { plan?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const plan = body.plan;
  if (plan !== "PLUS" && plan !== "PRO") {
    return NextResponse.json(
      { error: "plan must be PLUS or PRO." },
      { status: 400 },
    );
  }

  const pricing = PLAN_PRICING[plan];

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

  const credential = await getDecryptedCcpaymentCredential(prisma, {
    organizationId: workspace.organizationId,
  });

  let config: CcpaymentConfig;
  if (credential) {
    config = { appId: credential.appId, appSecret: credential.appSecret };
  } else {
    const envAppId = process.env.CCPAYMENT_APP_ID;
    const envAppSecret = process.env.CCPAYMENT_APP_SECRET;
    if (!envAppId || !envAppSecret) {
      return NextResponse.json(
        { error: "CCPayment credentials are not configured." },
        { status: 500 },
      );
    }
    config = { appId: envAppId, appSecret: envAppSecret };
  }

  const orderId = generateOrderId();
  const periodStart = new Date();
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + pricing.months);

  const notifyUrl = buildNotifyUrl(request.url);

  let result;
  try {
    result = await createCcpaymentInvoice(config, {
      orderId,
      fiatAmount: pricing.amount,
      fiatId: 1,
      notifyUrl,
    });
  } catch (error) {
    process.stderr.write(
      `[ccpayment-create-invoice] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return NextResponse.json(
      { error: "Failed to create CCPayment invoice." },
      { status: 502 },
    );
  }

  const invoice = await createPaymentInvoice(prisma, {
    organizationId: workspace.organizationId,
    plan,
    amount: pricing.amount,
    currency: "USD",
    provider: "ccpayment",
    providerOrderId: result.orderId,
    invoiceUrl: result.invoiceUrl,
    periodStart,
    periodEnd,
  });

  await recordUsageEvent(prisma, {
    metadata: {
      action: "create-ccpayment-invoice",
      invoiceId: invoice.id,
      orderId,
      plan,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: invoice.id,
    subjectType: "payment-invoice",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });

  return NextResponse.json({
    invoiceUrl: result.invoiceUrl,
    orderId: result.orderId,
    invoiceId: invoice.id,
  });
}

function generateOrderId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex");
  return `wc_${timestamp}_${random}`;
}

function buildNotifyUrl(requestUrl: string): string | undefined {
  try {
    const parsed = new URL(requestUrl);
    return `${parsed.origin}/api/billing/ccpayment/webhook`;
  } catch {
    const base = process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    if (!base) return undefined;
    try {
      const parsed = new URL(base);
      return `${parsed.origin}/api/billing/ccpayment/webhook`;
    } catch {
      return undefined;
    }
  }
}
