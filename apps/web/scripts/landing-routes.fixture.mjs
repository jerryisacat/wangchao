import { readFile } from "node:fs/promises";
import {
  hasBetterAuthSessionCookie,
  resolveBetterAuthSessionCandidate,
} from "../src/lib/auth-access.ts";
import {
  buildTopicCreationHref,
  buildLegacyDashboardRedirect,
  normalizeProductReturnPath,
  resolveShellVariant,
} from "../src/lib/web-routes.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(resolveShellVariant("/") === "marketing", "Root must use the marketing shell.");
assert(resolveShellVariant("/pricing") === "marketing", "Pricing must use the marketing shell.");
assert(resolveShellVariant("/login") === "auth", "Login must use the auth shell.");
assert(resolveShellVariant("/register/") === "auth", "Register slash variant must use auth shell.");
assert(resolveShellVariant("/app") === "product", "App home must use the product shell.");
assert(resolveShellVariant("/briefings") === "product", "Product pages must keep the product shell.");

assert(
  buildLegacyDashboardRedirect({ q: "C919", topic: "topic-1", view: "high" }) ===
    "/app?q=C919&topic=topic-1&view=high",
  "Legacy dashboard query must move to /app.",
);
assert(
  buildLegacyDashboardRedirect({ q: ["first", "second"], utm_source: "telegram" }) ===
    "/app?q=first",
  "Legacy redirect must use the first query value and drop marketing parameters.",
);
assert(
  buildLegacyDashboardRedirect({ utm_source: "telegram", campaign: "launch" }) === null,
  "Marketing parameters alone must stay on the landing page.",
);
assert(
  buildLegacyDashboardRedirect({ view: "all" }) === "/app?view=all",
  "The legacy all-intelligence view must move to /app.",
);
assert(
  buildLegacyDashboardRedirect({ view: "unknown" }) === null,
  "Unknown dashboard view must not trigger a redirect.",
);

assert(buildTopicCreationHref(true) === "/topics/new", "Workspace users must create topics directly.");
assert(
  buildTopicCreationHref(false) === "/register?next=%2Ftopics%2Fnew",
  "Anonymous commercial visitors must register before topic creation.",
);
assert(
  normalizeProductReturnPath("/app?q=C919&view=high") === "/app?q=C919&view=high",
  "A product return path must preserve filters.",
);
assert(normalizeProductReturnPath("/") === "/app", "Marketing root must not be a product return path.");
assert(
  normalizeProductReturnPath("/pricing") === "/app",
  "Marketing pricing must not be a product return path.",
);
assert(
  normalizeProductReturnPath("//evil.example") === "/app",
  "Protocol-relative return paths must be rejected.",
);
assert(
  hasBetterAuthSessionCookie("better-auth.session_token=abc123"),
  "The default Better Auth session cookie must be detected.",
);
assert(
  hasBetterAuthSessionCookie("__Secure-better-auth.session_token=abc123; theme=light"),
  "The production secure Better Auth session cookie must be detected.",
);
assert(
  !hasBetterAuthSessionCookie("theme=light; analytics_id=abc123"),
  "Unrelated cookies must not trigger a database session lookup.",
);
assert(!hasBetterAuthSessionCookie(null), "Missing cookies must remain database-free.");

let sessionLoads = 0;
const anonymousSession = await resolveBetterAuthSessionCandidate(
  "theme=light",
  async () => {
    sessionLoads += 1;
    return { userId: "unexpected" };
  },
);
assert(anonymousSession === null, "A request without a session cookie must stay anonymous.");
assert(sessionLoads === 0, "A request without a session cookie must not load Auth or Prisma.");
const cookieSession = await resolveBetterAuthSessionCandidate(
  "better-auth.session_token=abc123",
  async () => {
    sessionLoads += 1;
    return { userId: "user-1" };
  },
);
assert(cookieSession?.userId === "user-1", "A session cookie must resolve through Better Auth.");
assert(sessionLoads === 1, "A session candidate must load Auth exactly once.");

const migrationSources = await Promise.all(
  [
    "../src/app/actions/events.ts",
    "../src/app/actions/sources.ts",
    "../src/app/actions/topics.ts",
    "../src/app/actions/workspace.ts",
    "../src/components/intelligence/intelligence-card.tsx",
  ].map(async (relativePath) => [
    relativePath,
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  ]),
);

for (const [relativePath, source] of migrationSources) {
  assert(
    !source.includes('actionRedirectHref("/",'),
    `${relativePath} must not redirect product actions to the marketing homepage.`,
  );
  assert(
    !source.includes('name="returnTo" type="hidden" value="/"'),
    `${relativePath} must not submit the marketing homepage as a product return path.`,
  );
}

for (const relativePath of [
  "../src/app/actions/events.ts",
  "../src/app/actions/sources.ts",
  "../src/app/actions/topics.ts",
]) {
  const source = migrationSources.find(([path]) => path === relativePath)?.[1] ?? "";
  assert(
    !source.includes('revalidatePath("/")'),
    `${relativePath} must revalidate /app instead of the marketing homepage.`,
  );
}
