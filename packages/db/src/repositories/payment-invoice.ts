import { Prisma, type PrismaClient } from "@prisma/client";

export interface PaymentInvoiceRecord {
  id: string;
  organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: string;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export async function createPaymentInvoice(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    plan: "FREE" | "PLUS" | "PRO";
    amount: number;
    currency?: string;
    provider?: string;
    providerOrderId?: string;
    invoiceUrl?: string;
    periodStart?: Date;
    periodEnd?: Date;
  },
): Promise<PaymentInvoiceRecord> {
  const invoice = await prisma.paymentInvoice.create({
    data: {
      organizationId: input.organizationId,
      plan: input.plan,
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency ?? "USD",
      status: "PENDING",
      provider: input.provider ?? "ccpayment",
      providerOrderId: input.providerOrderId ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    },
  });

  return toPaymentInvoiceRecord(invoice);
}

export async function findPaymentInvoiceByOrderId(
  prisma: PrismaClient,
  provider: string,
  organizationId: string,
  providerOrderId: string,
): Promise<PaymentInvoiceRecord | null> {
  const invoice = await prisma.paymentInvoice.findFirst({
    where: { provider, organizationId, providerOrderId },
  });

  return invoice ? toPaymentInvoiceRecord(invoice) : null;
}

export async function updatePaymentInvoiceStatus(
  prisma: PrismaClient,
  invoiceId: string,
  status: string,
  metadata?: unknown,
): Promise<void> {
  const existing = await prisma.paymentInvoice.findUnique({
    where: { id: invoiceId },
    select: { metadata: true },
  });

  const mergedMetadata =
    metadata !== undefined
      ? mergeMetadata(existing?.metadata, metadata)
      : undefined;

  const data: Prisma.PaymentInvoiceUpdateInput = { status };
  if (mergedMetadata !== undefined) {
    data.metadata = mergedMetadata as Prisma.InputJsonValue;
  }

  await prisma.paymentInvoice.update({
    where: { id: invoiceId },
    data,
  });
}

function mergeMetadata(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const extra =
    incoming !== null && typeof incoming === "object" && !Array.isArray(incoming)
      ? { ...(incoming as Record<string, unknown>) }
      : {};
  return { ...base, ...extra };
}

function toPaymentInvoiceRecord(row: {
  id: string;
  organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: { toNumber(): number; toString(): string } | number;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  invoiceUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}): PaymentInvoiceRecord {
  const amountStr = typeof row.amount === "number" ? row.amount.toString() : row.amount.toString();
  return {
    id: row.id,
    organizationId: row.organizationId,
    plan: row.plan,
    amount: amountStr,
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    invoiceUrl: row.invoiceUrl,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
