const SAFE_NONCE_PATTERN = /^[A-Za-z0-9+/_=-]+$/;

export function buildContentSecurityPolicy(nonce: string): string {
  if (!nonce || !SAFE_NONCE_PATTERN.test(nonce)) {
    throw new Error("CSP nonce must be a non-empty base64 or base64url value.");
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
