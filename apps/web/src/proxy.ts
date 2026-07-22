import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import { buildLoginPath, isApiPath, isPublicAuthPath } from "@/lib/auth-access";
import { isAuthEnabled } from "@/lib/auth";
import {
  buildLegacyDashboardRedirect,
  REQUEST_PATHNAME_HEADER,
} from "@/lib/web-routes";
import { evaluateAccountGate, shouldRevokeSessions } from "@/lib/account-gate";

const isDev = process.env.NODE_ENV === "development";

export async function proxy(request: NextRequest) {
  const nonce = isDev ? null : Buffer.from(randomUUID(), "utf8").toString("base64");
  const contentSecurityPolicy = nonce ? buildContentSecurityPolicy(nonce) : null;
  const legacyRedirect = createLegacyDashboardRedirect(request);
  const gatedResponse = legacyRedirect ? null : await createAuthGateResponse(request);
  const response =
    legacyRedirect ?? gatedResponse ?? createNextResponse(request, nonce, contentSecurityPolicy);

  applySecurityHeaders(response, contentSecurityPolicy);
  return response;
}

function createLegacyDashboardRedirect(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== "/") return null;

  const params: Record<string, string | string[] | undefined> = {};
  for (const key of ["q", "topic", "view"] as const) {
    const values = request.nextUrl.searchParams.getAll(key);
    if (values.length === 1) params[key] = values[0];
    if (values.length > 1) params[key] = values;
  }

  const destination = buildLegacyDashboardRedirect(params);
  return destination
    ? NextResponse.redirect(new URL(destination, request.url))
    : null;
}

async function createAuthGateResponse(request: NextRequest): Promise<NextResponse | null> {
  if (!isAuthEnabled() || isPublicAuthPath(request.nextUrl.pathname)) return null;

  let sessionUserId: string | null = null;

  try {
    const { getAuth } = await import("@/lib/auth");
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      sessionUserId = session.user.id;
    }
  } catch {
    return NextResponse.json(
      { code: "AUTH_UNAVAILABLE", error: "Authentication service unavailable." },
      { status: 503 },
    );
  }

  // No session → unauthenticated flow (401 for API, redirect for pages).
  if (!sessionUserId) {
    if (isApiPath(request.nextUrl.pathname) || request.headers.has("next-action")) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", error: "Authentication required." },
        { status: 401 },
      );
    }

    const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(new URL(buildLoginPath(returnPath), request.url));
  }

  // Issue #157: Session exists — check accountStatus before allowing.
  // A SUSPENDED or DELETED user must not use existing sessions.
  const accountGateResponse = await checkAccountStatus(request, sessionUserId);
  if (accountGateResponse) return accountGateResponse;

  // Account is active (or status check failed open) — allow the request.
  return null;
}

/**
 * Issue #157 — Account status gate.
 *
 * After better-auth confirms a valid session, check the user's accountStatus.
 * If SUSPENDED or DELETED:
 *   1. Revoke all sessions for the user (force re-authentication on next request).
 *   2. Return 401 for API/Server Action requests, or redirect to login for pages.
 *
 * This catches sessions that were created before the user was suspended.
 */
async function checkAccountStatus(
  request: NextRequest,
  userId: string,
): Promise<NextResponse | null> {
  try {
    const { getPrismaClient, getUserLifecycleStatus, revokeUserSessions } = await import(
      "@wangchao/db"
    );
    const prisma = getPrismaClient();
    const status = await getUserLifecycleStatus(prisma, userId);

    // If user doesn't exist in our DB (edge case: better-auth session exists
    // but user was hard-deleted), deny access.
    if (!status) {
      return createDenialResponse(request, "ACCOUNT_DELETED");
    }

    const decision = evaluateAccountGate(status.accountStatus);
    if (!shouldRevokeSessions(decision)) return null;

    // Revoke all sessions so the user must re-authenticate.
    // On the next request, getSession will return null and the normal
    // unauthenticated flow takes over.
    await revokeUserSessions(prisma, userId);

    return createDenialResponse(request, decision.reason);
  } catch {
    // If we can't check the account status (DB unavailable, etc.),
    // fail open — the session check itself is the primary gate.
    // Do NOT lock out all users if the DB is temporarily unreachable.
    return null;
  }
}

function createDenialResponse(
  request: NextRequest,
  reason: "ACCOUNT_SUSPENDED" | "ACCOUNT_DELETED",
): NextResponse {
  if (isApiPath(request.nextUrl.pathname) || request.headers.has("next-action")) {
    return NextResponse.json(
      { code: reason, error: "Account access denied." },
      { status: 403 },
    );
  }

  // For page requests, redirect to login with a denial message.
  const params = new URLSearchParams({ reason });
  return NextResponse.redirect(new URL(`/login?${params.toString()}`, request.url));
}

function createNextResponse(
  request: NextRequest,
  nonce: string | null,
  contentSecurityPolicy: string | null,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);

  if (nonce && contentSecurityPolicy) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

function applySecurityHeaders(
  response: NextResponse,
  contentSecurityPolicy: string | null,
): void {
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (contentSecurityPolicy) {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
