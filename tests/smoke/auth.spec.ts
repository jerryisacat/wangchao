import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const AUTH_ENABLED =
  (Boolean(process.env.PLAYWRIGHT_AUTH_ENABLED) || Boolean(process.env.BETTER_AUTH_SECRET)) &&
  Boolean(process.env.DATABASE_URL);
const testSuffix = process.env.PLAYWRIGHT_AUTH_RUN_ID ?? randomUUID();
const testEmail = `e2e-${testSuffix}@wangchao.test`;
const secondEmail = `e2e2-${testSuffix}@wangchao.test`;
const testPassword = "TestPassword123!";
const testName = `E2E Test ${testSuffix}`;
const secondName = `E2E Test2 ${testSuffix}`;

interface MembershipSnapshot {
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

async function readMemberships(email: string): Promise<MembershipSnapshot[]> {
  const { getPrismaClient } = await import("../../packages/db/dist/index.js");
  const user = await getPrismaClient().user.findUnique({
    where: { email },
    select: {
      memberships: {
        orderBy: { createdAt: "asc" },
        select: { organizationId: true, role: true },
      },
    },
  });
  return user?.memberships ?? [];
}

async function cleanupAuthFixtures(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { disconnectPrismaClient, getPrismaClient } = await import("../../packages/db/dist/index.js");
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    where: { email: { in: [testEmail, secondEmail] } },
    select: { id: true, memberships: { select: { organizationId: true } } },
  });
  const organizationIds = users.flatMap((user) =>
    user.memberships.map((membership) => membership.organizationId),
  );
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await disconnectPrismaClient();
}

async function loginExistingUser(page: Page, loginPath = "/login"): Promise<void> {
  await page.goto(loginPath);
  await page.getByLabel("邮箱").fill(testEmail);
  await page.getByLabel("密码").fill(testPassword);
  await page.getByRole("button", { name: "登录" }).click();
}

async function deleteUserSessions(email: string): Promise<void> {
  const { getPrismaClient } = await import("../../packages/db/dist/index.js");
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await prisma.session.deleteMany({ where: { userId: user.id } });
}

async function expectLoginRedirect(page: Page, returnPath: string): Promise<void> {
  await page.waitForURL(
    (url) => url.pathname === "/login" && url.searchParams.get("next") === returnPath,
  );
}

test.describe("Better Auth end-to-end", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!AUTH_ENABLED, "BETTER_AUTH_SECRET and DATABASE_URL are required");
  test.beforeEach(async ({ page }, testInfo) => {
    // Keep desktop/mobile projects from sharing Better Auth's in-memory IP rate-limit bucket.
    const projectAddress = testInfo.project.name.includes("mobile")
      ? "198.51.100.20"
      : "198.51.100.10";
    await page.setExtraHTTPHeaders({ "x-forwarded-for": projectAddress });
  });
  test.afterAll(cleanupAuthFixtures);

  test("register → workspace → session reload → logout → re-login", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("注册望潮", { exact: true })).toBeVisible();
    await page.getByLabel("显示名称").fill(testName);
    await page.getByLabel("邮箱").fill(testEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "注册" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "未读情报" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "未读情报" })).toBeVisible();

    const memberships = await readMemberships(testEmail);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("OWNER");

    await page.getByRole("button", { name: "登出" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await page.getByLabel("邮箱").fill(testEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("/", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "未读情报" })).toBeVisible();
    expect(await readMemberships(testEmail)).toEqual(memberships);
  });

  test("protected pages and APIs require authentication", async ({ page }) => {
    await page.context().clearCookies();

    const redirectResponse = await page.request.get("/sources?status=ACTIVE", {
      maxRedirects: 0,
    });
    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers()["content-security-policy"]).toContain("'nonce-");
    expect(redirectResponse.headers()["x-frame-options"]).toBe("DENY");

    for (const path of ["/", "/sources?status=ACTIVE", "/admin/settings"]) {
      await page.goto(path);
      await expectLoginRedirect(page, path);
    }

    const apiResponse = await page.request.post("/api/billing/stripe/checkout");
    expect(apiResponse.status()).toBe(401);
    expect(apiResponse.headers()["x-frame-options"]).toBe("DENY");
    expect(await apiResponse.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("external next targets are rejected", async ({ page }) => {
    await loginExistingUser(page, "/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    await page.waitForURL("/", { timeout: 15_000 });
    await expect(page).toHaveURL("/");
  });

  test("a cookie with a deleted database session is rejected", async ({ page }) => {
    await page.context().clearCookies();
    await loginExistingUser(page);
    await page.waitForURL("/", { timeout: 15_000 });
    await deleteUserSessions(testEmail);
    await page.goto("/sources");
    await expectLoginRedirect(page, "/sources");
  });

  test("second user receives an isolated owner workspace", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/register");
    await page.getByLabel("显示名称").fill(secondName);
    await page.getByLabel("邮箱").fill(secondEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "注册" }).click();
    await page.waitForURL("/", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "未读情报" })).toBeVisible();

    const firstMemberships = await readMemberships(testEmail);
    const secondMemberships = await readMemberships(secondEmail);
    expect(firstMemberships).toHaveLength(1);
    expect(secondMemberships).toHaveLength(1);
    expect(secondMemberships[0]?.role).toBe("OWNER");
    expect(secondMemberships[0]?.organizationId).not.toBe(firstMemberships[0]?.organizationId);
    await context.close();
  });
});
