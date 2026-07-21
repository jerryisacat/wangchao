const INTERNAL_ORIGIN = "http://wangchao.internal";
export const UNAUTHENTICATED_ERROR = "UNAUTHENTICATED";
const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/register",
  "/pricing",
  "/api/health",
  "/api/billing/ccpayment/webhook",
  "/api/billing/stripe/webhook",
]);

export function isPublicAuthPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    PUBLIC_EXACT_PATHS.has(normalized) ||
    normalized === "/api/auth" ||
    normalized.startsWith("/api/auth/")
  );
}

export function normalizeAuthReturnPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || !parsed.pathname.startsWith("/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildLoginPath(returnPath: string): string {
  const params = new URLSearchParams({ next: normalizeAuthReturnPath(returnPath) });
  return `/login?${params.toString()}`;
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
