import {
  buildLoginPath,
  isPublicAuthPath,
  normalizeAuthReturnPath,
} from "../src/lib/auth-access.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const path of [
  "/",
  "/login",
  "/login/",
  "/register",
  "/register/",
  "/pricing",
  "/api/health",
  "/api/auth/session",
  "/api/billing/ccpayment/webhook",
  "/api/billing/stripe/webhook",
]) {
  assert(isPublicAuthPath(path), `${path} must remain public.`);
}

for (const path of ["/app", "/sources", "/admin/settings", "/api/billing/stripe/checkout"]) {
  assert(!isPublicAuthPath(path), `${path} must require authentication.`);
}

assert(
  normalizeAuthReturnPath("/sources?status=ACTIVE") === "/sources?status=ACTIVE",
  "Internal path and query must be preserved.",
);
assert(normalizeAuthReturnPath("https://evil.example") === "/app", "Absolute URL must be rejected.");
assert(normalizeAuthReturnPath("//evil.example") === "/app", "Protocol-relative URL must be rejected.");
assert(normalizeAuthReturnPath("/\\evil.example") === "/app", "Backslash URL must be rejected.");
assert(normalizeAuthReturnPath("/safe\nheader") === "/app", "Control characters must be rejected.");
assert(normalizeAuthReturnPath(null) === "/app", "Missing return path must use app fallback.");
assert(
  buildLoginPath("/sources?status=ACTIVE") ===
    "/login?next=%2Fsources%3Fstatus%3DACTIVE",
  "Login path must encode the safe internal return path.",
);
