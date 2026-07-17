import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import { buildLoginPath, isApiPath, isPublicAuthPath } from "@/lib/auth-access";
import { isAuthEnabled } from "@/lib/auth";

const isDev = process.env.NODE_ENV === "development";

export async function proxy(request: NextRequest) {
  const nonce = isDev ? null : Buffer.from(randomUUID(), "utf8").toString("base64");
  const contentSecurityPolicy = nonce ? buildContentSecurityPolicy(nonce) : null;
  const gatedResponse = await createAuthGateResponse(request);
  const response = gatedResponse ?? createNextResponse(request, nonce, contentSecurityPolicy);

  applySecurityHeaders(response, contentSecurityPolicy);
  return response;
}

async function createAuthGateResponse(request: NextRequest): Promise<NextResponse | null> {
  if (!isAuthEnabled() || isPublicAuthPath(request.nextUrl.pathname)) return null;

  try {
    const { getAuth } = await import("@/lib/auth");
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) return null;
  } catch {
    return NextResponse.json(
      { code: "AUTH_UNAVAILABLE", error: "Authentication service unavailable." },
      { status: 503 },
    );
  }

  if (isApiPath(request.nextUrl.pathname) || request.headers.has("next-action")) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", error: "Authentication required." },
      { status: 401 },
    );
  }

  const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(new URL(buildLoginPath(returnPath), request.url));
}

function createNextResponse(
  request: NextRequest,
  nonce: string | null,
  contentSecurityPolicy: string | null,
): NextResponse {
  if (!nonce || !contentSecurityPolicy) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
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
