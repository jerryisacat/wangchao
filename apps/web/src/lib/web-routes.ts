export const APP_HOME_PATH = "/app";
export const REQUEST_PATHNAME_HEADER = "x-wangchao-pathname";

export type ShellVariant = "auth" | "marketing" | "product";

type SearchParamValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamValue>;

const AUTH_PATHS = new Set(["/login", "/register"]);
const MARKETING_PATHS = new Set(["/", "/pricing"]);
const DASHBOARD_VIEWS = new Set(["all", "high", "saved"]);
const INTERNAL_ORIGIN = "http://wangchao.internal";

export function resolveShellVariant(pathname: string): ShellVariant {
  const normalized = normalizePathname(pathname);
  if (AUTH_PATHS.has(normalized)) return "auth";
  if (MARKETING_PATHS.has(normalized)) return "marketing";
  return "product";
}

export function buildLegacyDashboardRedirect(searchParams: SearchParams): string | null {
  const query = readParam(searchParams.q, 80);
  const topic = readParam(searchParams.topic, 120);
  const rawView = readParam(searchParams.view, 16);
  const view = rawView && DASHBOARD_VIEWS.has(rawView) ? rawView : "";

  if (!query && !topic && !view) return null;

  const target = new URLSearchParams();
  if (query) target.set("q", query);
  if (topic) target.set("topic", topic);
  if (view) target.set("view", view);
  return `${APP_HOME_PATH}?${target.toString()}`;
}

export function buildTopicCreationHref(hasWorkspaceAccess: boolean): string {
  return hasWorkspaceAccess ? "/topics/new" : "/register?next=%2Ftopics%2Fnew";
}

export function normalizeProductReturnPath(
  value: string | null | undefined,
  fallback = APP_HOME_PATH,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || resolveShellVariant(parsed.pathname) !== "product") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function readParam(value: SearchParamValue, maxLength: number): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, maxLength) : "";
}
