import { expect, test } from "@playwright/test";

const AUTH_ENABLED =
  Boolean(process.env.PLAYWRIGHT_AUTH_ENABLED) ||
  Boolean(process.env.BETTER_AUTH_SECRET);

const testSuffix = process.env.PLAYWRIGHT_AUTH_RUN_ID ?? Date.now().toString();
const testEmail = `e2e-${testSuffix}@wangchao.test`;
const testPassword = "TestPassword123!";
const testName = `E2E Test ${testSuffix}`;

test.describe("Better Auth end-to-end", () => {
  test.skip(!AUTH_ENABLED, "BETTER_AUTH_SECRET is not set — auth tests skipped");

  test("register → auto org → dashboard visible", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "注册望潮" })).toBeVisible();

    await page.getByLabel("显示名称").fill(testName);
    await page.getByLabel("邮箱").fill(testEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "注册" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "未读情报" }),
    ).toBeVisible();
  });

  test("logout → redirected to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(testEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "登录" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "未读情报" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "登出" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("re-login restores workspace", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(testEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "登录" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "未读情报" }),
    ).toBeVisible();
  });

  test("admin page requires authentication", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin/settings");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("root page requires authentication", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("second user gets isolated workspace", async ({ browser }) => {
    const secondEmail = `e2e2-${testSuffix}@wangchao.test`;
    const secondName = `E2E Test2 ${testSuffix}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/register");
    await page.getByLabel("显示名称").fill(secondName);
    await page.getByLabel("邮箱").fill(secondEmail);
    await page.getByLabel("密码").fill(testPassword);
    await page.getByRole("button", { name: "注册" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "未读情报" }),
    ).toBeVisible();

    await context.close();
  });
});
