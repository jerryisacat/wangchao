import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";

const isDev = process.env.NODE_ENV === "development";

export function proxy(request: NextRequest) {
  const nonce = isDev
    ? null
    : Buffer.from(randomUUID(), "utf8").toString("base64");
  const contentSecurityPolicy = nonce ? buildContentSecurityPolicy(nonce) : null;
  const response = nonce && contentSecurityPolicy
    ? nextWithContentSecurityPolicy(request, nonce, contentSecurityPolicy)
    : NextResponse.next();

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

  return response;
}

function nextWithContentSecurityPolicy(
  request: NextRequest,
  nonce: string,
  contentSecurityPolicy: string,
) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
