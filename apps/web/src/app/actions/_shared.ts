import { isHttpUrl } from "@wangchao/core";

export type DatabaseClient = ReturnType<
  (typeof import("@wangchao/db"))["getPrismaClient"]
>;

export type ActionRedirectType = "error" | "notice";

export function logActionError(action: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "Error";
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  const codeSegment =
    typeof code === "string" && code.length > 0 ? `(${code})` : "";
  process.stderr.write(`[${action}] ${name}${codeSegment}: ${message}\n`);
}

export function actionRedirectHref(
  path: string,
  type: ActionRedirectType,
  message: string,
): string {
  const params = new URLSearchParams({ [type]: message });
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${params.toString()}`;
}

export function toUserActionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "操作未完成，请稍后重试。";
  }

  const message = error.message;

  switch (message) {
    case "AI_API_KEY_MISSING":
      return "AI API Key 未随保存请求提交，请重新输入后测试并保存。";
    case "SEARCH_API_KEY_MISSING":
      return "搜索 API Key 未随保存请求提交，请重新输入后测试并保存。";
    case "TELEGRAM_BOT_TOKEN_MISSING":
      return "请输入 Telegram Bot Token。";
    case "TELEGRAM_CHAT_ID_MISSING":
      return "请输入 Telegram Chat ID。";
    case "INSTANT_PUSH_PLAN_BLOCKED":
      return "即时推送仅对 Plus、Pro 或自用模式开放。";
    case "BYOK_API_KEY_MISSING":
      return "请输入 BYOK API Key。";
    case "BYOK_BASE_URL_MISSING":
      return "请填写 BYOK Base URL。";
    case "CCPAYMENT_APP_ID_MISSING":
      return "请输入 CCPayment App ID。";
    case "CCPAYMENT_APP_SECRET_MISSING":
      return "请输入 CCPayment App Secret。";
    case "AI_BASE_URL_INVALID":
      return "AI Base URL 必须是有效的 HTTP 或 HTTPS 地址。";
    case "UNAUTHENTICATED":
      return "登录状态已失效，请刷新页面重新登录后再操作。";
  }

  if (message.startsWith("INSTANT_PUSH_TELEGRAM_MISSING")) {
    return "请先前往「管理 -> Telegram」配置机器人凭据后再开启即时推送。";
  }

  if (isPrismaUniqueConstraintError(error)) {
    return "该名称或地址已存在，请勿重复创建，或更换后重试。";
  }

  const quotaHint = describeQuotaMessage(message);
  if (quotaHint) {
    return quotaHint;
  }

  if (
    /database connection is required/i.test(message) ||
    /DATABASE_URL is required/.test(message)
  ) {
    return "数据库连接未就绪，请确认 DATABASE_URL 配置正确且数据库可访问后重启服务。";
  }

  if (/ENCRYPTION_KEY is required/.test(message)) {
    return "加密密钥未配置，请设置 ENCRYPTION_KEY 环境变量后重启服务。";
  }

  if (/HTTP or HTTPS URL/.test(message)) {
    return "请输入有效的 HTTP 或 HTTPS RSS 地址。";
  }

  if (/not authorized/i.test(message)) {
    return "当前账号无权执行此操作，请联系工作区管理员调整角色后重试。";
  }

  if (/\bnot found\b/i.test(message)) {
    return "操作的对象不存在或已不属于当前工作区，请刷新页面后重试。";
  }

  if (/too long/i.test(message)) {
    return "输入内容过长，请精简后重试。";
  }

  if (/must be/i.test(message)) {
    return "提交的参数不合法，请检查输入后重试。";
  }

  if (/required/i.test(message)) {
    return "请补全必填内容后再提交。";
  }

  const detail = sanitizeErrorDetail(message);
  return `操作未完成${detail ? `：${detail}` : ""}。若持续失败，请查看服务器日志中对应的 [xxxAction] 错误行。`;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code === "P2002";
}

function describeQuotaMessage(message: string): string | null {
  const match = message.match(
    /^([\w ]+?) limit reached \((\d+)\/(\d+|null)\)\.$/i,
  );
  if (!match) {
    if (/limit reached/i.test(message)) {
      return "已达当前套餐的使用上限，请升级套餐或清理已有记录后重试。";
    }
    return null;
  }

  const resource = quotaResourceLabel(match[1]);
  const current = match[2];
  const limit = match[3];
  const usage = limit === "null" ? `（已用 ${current}）` : `（${current}/${limit}）`;

  return `已达当前套餐的${resource}上限${usage}，请升级套餐或在管理页清理已有记录后重试。`;
}

function quotaResourceLabel(resource: string | undefined): string {
  switch ((resource ?? "").toLowerCase()) {
    case "topic":
      return "主题数量";
    case "source":
      return "信源数量";
    case "ai":
    case "ai call":
      return "AI 调用";
    case "daily ai call":
      return "每日 AI 调用";
    case "monthly ai call":
      return "每月 AI 调用";
    case "export":
    case "monthly export":
      return "导出";
    default:
      return "使用";
  }
}

function sanitizeErrorDetail(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
}

export function readRequiredField(formData: FormData, key: string): string {
  const value = readOptionalField(formData, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

export function readOptionalField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readProfileListField(
  formData: FormData,
  key: string,
  required = false,
): string[] {
  const rawValue = readOptionalField(formData, key);

  if (rawValue.length > 5_000) {
    throw new Error(`${key} is too long.`);
  }

  const values = Array.from(
    new Set(
      rawValue
        .split(/[\n,，]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (required && values.length === 0) {
    throw new Error(`${key} is required.`);
  }
  if (values.length > 50 || values.some((value) => value.length > 160)) {
    throw new Error(`${key} contains too many or overly long values.`);
  }

  return values;
}

export function readPositiveInteger(
  formData: FormData,
  key: string,
  fallback: number,
): number {
  const raw = readOptionalField(formData, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
): T {
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : (allowed[0] as T);
}

export function readJsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function readSafeReturnPath(formData: FormData, key: string): string | null {
  const value = readOptionalField(formData, key);
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "http://wangchao.internal");
    if (url.origin !== "http://wangchao.internal") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function readRequiredUrl(formData: FormData, key: string): string {
  const value = readRequiredField(formData, key);
  const parsed = new URL(value);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} must be an HTTP or HTTPS URL.`);
  }

  return parsed.toString();
}

export function readDashboardEventAction(
  formData: FormData,
  key: string,
): "read" | "save" | "unsave" | "dismiss" | "archive" | "restore" {
  const value = readRequiredField(formData, key);

  if (
    value === "read" ||
    value === "save" ||
    value === "unsave" ||
    value === "dismiss" ||
    value === "archive" ||
    value === "restore"
  ) {
    return value;
  }

  throw new Error(`${key} must be read, save, unsave, dismiss, archive, or restore.`);
}

export function readCategoryPreferenceAction(
  formData: FormData,
  key: string,
): "up" | "down" {
  const value = readRequiredField(formData, key);

  if (value === "up" || value === "down") {
    return value;
  }

  throw new Error(`${key} must be up or down.`);
}

export function readSourceGovernanceAction(
  formData: FormData,
  key: string,
): "approve" | "mute" | "reject" | "observe" {
  const value = readRequiredField(formData, key);

  if (
    value === "approve" ||
    value === "mute" ||
    value === "reject" ||
    value === "observe"
  ) {
    return value;
  }

  throw new Error(`${key} must be approve, mute, reject, or observe.`);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export interface SeedSourcePack {
  topics?: Array<{
    description?: string;
    keywords?: string[];
    name: string;
    sources?: Array<{
      name: string;
      url: string;
    }>;
  }>;
  version?: number;
}

export interface MatchedSourcePackCandidate {
  matchedKeywords: string[];
  name: string;
  relevanceScore: number;
  topicName: string;
  url: string;
}

export function matchSourcePackCandidates(input: {
  description: string;
  limit: number;
  name: string;
  profileKeywords: string[];
  sourcePack: SeedSourcePack;
}): MatchedSourcePackCandidate[] {
  const topicTerms = uniqueStrings([
    ...tokenizeText(input.name),
    ...tokenizeText(input.description),
    ...input.profileKeywords.flatMap(tokenizeText),
  ]);
  const candidates = (input.sourcePack.topics ?? []).flatMap((topic) => {
    const sourcePackTerms = uniqueStrings([
      ...tokenizeText(topic.name),
      ...tokenizeText(topic.description ?? ""),
      ...(topic.keywords ?? []).flatMap(tokenizeText),
    ]);
    const matchedKeywords = topicTerms.filter((term) =>
      sourcePackTerms.some((sourceTerm) => termsMatch(term, sourceTerm)),
    );

    if (matchedKeywords.length === 0) {
      return [];
    }

    const relevanceScore = Number(
      Math.min(1, 0.45 + matchedKeywords.length * 0.12).toFixed(2),
    );

    return (topic.sources ?? [])
      .filter((source) => isHttpUrl(source.url))
      .map((source) => ({
        matchedKeywords,
        name: source.name,
        relevanceScore,
        topicName: topic.name,
        url: source.url,
      }));
  });

  return dedupeMatchedSources(candidates).slice(0, input.limit);
}

export function dedupeMatchedSources(
  candidates: MatchedSourcePackCandidate[],
): MatchedSourcePackCandidate[] {
  const seen = new Set<string>();
  const unique: MatchedSourcePackCandidate[] = [];

  for (const candidate of candidates.sort(
    (left, right) => right.relevanceScore - left.relevanceScore,
  )) {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

export function tokenizeText(value: string): string[] {
  return value
    .split(/[\s,，、;；:：/|()\[\]{}"'“”‘’<>《》.!?！？\n\r\t]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .flatMap((term) => [term, ...extractCjkTerms(term)])
    .map((term) => term.toLowerCase())
    .filter((term) => !TOPIC_CREATE_STOP_WORDS.has(term));
}

export function extractCjkTerms(value: string): string[] {
  return [...value.matchAll(/[一-鿿]{2,8}/g)].map((match) => match[0]);
}

export function termsMatch(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export const TOPIC_CREATE_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "关注",
  "跟踪",
  "观察",
  "相关",
]);
