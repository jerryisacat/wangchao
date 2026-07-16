import assert from "node:assert/strict";
import { buildContentSecurityPolicy } from "../src/lib/content-security-policy.ts";

const nonce = "d2FuZ2NoYW8tY3NwLW5vbmNl";
const policy = buildContentSecurityPolicy(nonce);
const scriptDirective = policy
  .split("; ")
  .find((directive) => directive.startsWith("script-src "));

assert.equal(
  scriptDirective,
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
  "Next.js framework scripts must be authorized with the request nonce.",
);
assert.doesNotMatch(
  scriptDirective,
  /'unsafe-inline'/,
  "The production script policy must not weaken CSP with unsafe-inline.",
);
assert.match(policy, /script-src-attr 'none'/);
assert.match(policy, /object-src 'none'/);
assert.throws(() => buildContentSecurityPolicy("unsafe nonce; script-src *"));

if (process.env.BASE_URL) {
  await verifyLivePolicy(process.env.BASE_URL);
}

process.stdout.write("Content Security Policy fixture passed.\n");

async function verifyLivePolicy(baseUrl) {
  const firstResponse = await fetch(new URL("/login", baseUrl));
  const secondResponse = await fetch(new URL("/login", baseUrl));
  const firstPolicy = firstResponse.headers.get("content-security-policy");
  const secondPolicy = secondResponse.headers.get("content-security-policy");
  const firstNonce = readNonce(firstPolicy);
  const secondNonce = readNonce(secondPolicy);
  const html = await firstResponse.text();
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];

  assert.equal(firstResponse.status, 200);
  assert.notEqual(firstNonce, secondNonce, "Each request must receive a fresh CSP nonce.");
  assert(scriptTags.length > 0, "The Next.js page must contain framework scripts.");
  assert(
    scriptTags.every((tag) => tag.includes(`nonce="${firstNonce}"`)),
    "Every Next.js framework and Flight script must carry the response nonce.",
  );
}

function readNonce(policyHeader) {
  assert(policyHeader, "The production response must include Content-Security-Policy.");
  const match = policyHeader.match(/'nonce-([^']+)'/);
  assert(match?.[1], "The production script policy must include a nonce.");
  return match[1];
}
