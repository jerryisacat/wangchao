import crypto from "node:crypto";

const CCPAYMENT_API_BASE = "https://ccpayment.com/ccpayment/v2";

export interface CcpaymentConfig {
  appId: string;
  appSecret: string;
}

export interface CreateInvoiceInput {
  orderId: string;
  fiatAmount: number;
  fiatId?: number;
  notifyUrl?: string;
}

export interface CreateInvoiceResult {
  invoiceUrl: string;
  orderId: string;
}

export interface CcpaymentOrderInfo {
  status: string;
  isFlaggedAsRisky: boolean;
  amount: number;
}

interface CcpaymentApiResponse<T> {
  code: number;
  msg?: string;
  data?: T;
}

function signRequest(
  config: CcpaymentConfig,
  timestamp: string,
  payload: string,
): string {
  const signText = config.appId + timestamp + payload;
  return crypto.createHmac("sha256", config.appSecret).update(signText).digest("hex");
}

function buildHeaders(
  config: CcpaymentConfig,
  timestamp: string,
  signature: string,
): Record<string, string> {
  return {
    Appid: config.appId,
    Timestamp: timestamp,
    Sign: signature,
    "User-Agent": "wangchao/1.0 (+https://github.com/anomaly/wangchao)",
    "Content-Type": "application/json",
  };
}

function currentTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

async function postSigned<T>(
  config: CcpaymentConfig,
  path: string,
  payload: unknown,
): Promise<CcpaymentApiResponse<T>> {
  const body = JSON.stringify(payload ?? {});
  const timestamp = currentTimestamp();
  const signature = signRequest(config, timestamp, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${CCPAYMENT_API_BASE}${path}`, {
      method: "POST",
      headers: buildHeaders(config, timestamp, signature),
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `CCPayment ${path} failed: HTTP ${response.status} ${response.statusText}`.trim(),
      );
    }

    return (await response.json()) as CcpaymentApiResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCcpaymentInvoice(
  config: CcpaymentConfig,
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const payload: Record<string, unknown> = {
    orderId: input.orderId,
    fiatId: input.fiatId ?? 1,
    fiatAmount: input.fiatAmount,
  };

  if (input.notifyUrl) {
    payload.notifyUrl = input.notifyUrl;
  }

  const response = await postSigned<{
    invoiceUrl?: string;
    orderId?: string;
  }>(config, "/createInvoiceUrl", payload);

  if (response.code !== 10000) {
    throw new Error(
      `CCPayment createInvoiceUrl failed: code ${response.code} ${response.msg ?? ""}`.trim(),
    );
  }

  const data = response.data;
  if (!data || !data.invoiceUrl) {
    throw new Error("CCPayment createInvoiceUrl returned no invoiceUrl.");
  }

  return {
    invoiceUrl: data.invoiceUrl,
    orderId: data.orderId ?? input.orderId,
  };
}

export async function getCcpaymentOrderInfo(
  config: CcpaymentConfig,
  orderId: string,
): Promise<CcpaymentOrderInfo> {
  const response = await postSigned<{
    orderStatus?: string;
    isFlaggedAsRisky?: boolean;
    amount?: number;
  }>(config, "/getInvoiceOrderInfo", { orderId });

  if (response.code !== 10000) {
    throw new Error(
      `CCPayment getInvoiceOrderInfo failed: code ${response.code} ${response.msg ?? ""}`.trim(),
    );
  }

  const data = response.data;
  return {
    status: data?.orderStatus ?? "Unknown",
    isFlaggedAsRisky: Boolean(data?.isFlaggedAsRisky),
    amount: typeof data?.amount === "number" ? data.amount : 0,
  };
}

export function verifyCcpaymentWebhookSignature(
  config: CcpaymentConfig,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!timestamp || !signature) {
    return false;
  }

  const timestampMs = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampMs)) return false;
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (Math.abs(now - timestampMs) > FIVE_MINUTES) {
    return false;
  }

  const expected = signRequest(config, timestamp, rawBody);

  if (expected.length !== signature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function testCcpaymentCredential(
  config: CcpaymentConfig,
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const body = JSON.stringify({});
    const timestamp = currentTimestamp();
    const signature = signRequest(config, timestamp, body);
    const response = await fetch(`${CCPAYMENT_API_BASE}/getCoinList`, {
      method: "POST",
      headers: buildHeaders(config, timestamp, signature),
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `CCPayment 验证失败：HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const result = (await response.json()) as CcpaymentApiResponse<unknown>;
    if (result.code !== 10000) {
      return {
        ok: false,
        message: `CCPayment 验证失败：code ${result.code} ${result.msg ?? ""}`.trim(),
      };
    }

    return { ok: true, message: "CCpayment App ID 和 App Secret 验证成功。" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "CCPayment API 连接超时，请检查网络。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
