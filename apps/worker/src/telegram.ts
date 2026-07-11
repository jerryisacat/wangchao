const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const TELEGRAM_DELIVERY_TIMEOUT_MS = 15_000;

export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

export function formatEventForInstantPush(event: {
  title: string;
  summary: string;
  topicName: string;
  sourceName: string | null;
  sourceUrl: string | null;
  score: number;
}): string {
  const sourceUrl = safeHttpUrl(event.sourceUrl);
  const title = truncateText(event.title, 300);
  const summary = truncateText(event.summary, 2400);
  const topicName = truncateText(event.topicName, 150);
  const sourceName = truncateText(event.sourceName ?? "未知来源", 150);
  const lines = [
    "🚨 <b>高优先级情报</b>",
    "",
    `<b>${escapeTelegramHtml(title)}</b>`,
    "",
    escapeTelegramHtml(summary),
    "",
    `📂 主题：${escapeTelegramHtml(topicName)}`,
    `📡 来源：${escapeTelegramHtml(sourceName)}`,
    `⭐ 相关性：${Math.round(event.score)}/100`,
  ];
  if (sourceUrl) lines.push("", `<a href="${escapeTelegramHtml(sourceUrl)}">📖 阅读原文</a>`);
  return lines.join("\n");
}

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function truncateTelegramMessage(value: string): string {
  if (value.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return value;
  return `${value.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 8)}\n…（截断）`;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown",
): Promise<void> {
  const base = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      } | null;
      const code = body?.error_code?.toString() ?? response.status.toString();
      const retryAfterMs = body?.parameters?.retry_after ? body.parameters.retry_after * 1000 : undefined;
      throw new TelegramDeliveryError(
        `Telegram API error: ${body?.description ?? `HTTP ${response.status}`}`,
        code,
        response.status === 429 || response.status >= 500,
        retryAfterMs,
      );
    }
  } catch (error) {
    if (error instanceof TelegramDeliveryError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TelegramDeliveryError("Telegram API request timed out.", "TIMEOUT", true);
    }
    throw new TelegramDeliveryError(
      `Telegram request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      "NETWORK",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const normalized = url.toString();
    return (url.protocol === "http:" || url.protocol === "https:") && normalized.length <= 800
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
