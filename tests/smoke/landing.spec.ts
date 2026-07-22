import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const viewports = [
  { height: 720, width: 320 },
  { height: 812, width: 375 },
  { height: 896, width: 414 },
  { height: 1024, width: 768 },
  { height: 900, width: 1024 },
  { height: 1000, width: 1440 },
] as const;

const screenshotDir = "/tmp/wangchao-landing-qa";

function recordsProductRequest(url: string, resourceType: string): boolean {
  const pathname = new URL(url).pathname;
  return (
    resourceType !== "document" &&
    (/^\/app(?:\/|$)/.test(pathname) ||
      /^\/(?:topics|events|sources|reports)(?:\/|$)/.test(pathname))
  );
}

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });
});

test("public landing page is complete across release viewports", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const productRequests: string[] = [];
  page.on("request", (request) => {
    if (recordsProductRequest(request.url(), request.resourceType())) {
      productRequests.push(request.url());
    }
  });

  for (const viewport of viewports) {
    productRequests.length = 0;
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.locator('[data-shell="marketing"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /别追逐信息.*看见重要的变化/ }),
    ).toBeVisible();

    const canonicalHref = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonicalHref).not.toBeNull();
    expect(new URL(canonicalHref!).pathname).toBe("/");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /主题情报 Agent/,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /望潮/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      "content",
      /提炼关键变化/,
    );
    const openGraphUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(openGraphUrl).not.toBeNull();
    expect(new URL(openGraphUrl!).pathname).toBe("/");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );

    await expect(page.getByRole("link", { name: "免费创建第一个主题" }).first()).toHaveAttribute(
      "href",
      "/topics/new",
    );
    await expect(page.getByText("隐私自主", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "文档" })).toHaveAttribute(
      "href",
      "https://github.com/jerryisacat/wangchao#readme",
    );
    await expect(page.getByRole("link", { name: "条款 · MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/jerryisacat/wangchao/blob/master/LICENSE",
    );

    await page.locator("[data-demo-shell]").scrollIntoViewIfNeeded();
    const demo = page.locator("[data-demo-stage]");
    await expect(demo).toHaveAttribute("data-demo-stage", "5", { timeout: 5_000 });
    await expect(demo.getByRole("button", { name: "重新播放示例演示" })).toBeHidden();
    await expect(demo.getByText("C919 新增商业航线运营数据披露")).toBeVisible();
    await expect(demo.getByText("你的阅读、收藏、忽略与纠偏，会持续调整后续情报。")).toBeVisible();

    const layout = await page.evaluate(() => ({
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rawHtmlLeak: /<p>|<a href=|```/.test(document.body.innerText),
    }));
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(layout.rawHtmlLeak).toBe(false);

    await page.waitForTimeout(300);
    expect(productRequests, "Marketing must not prefetch Product Shell routes.").toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDir}/landing-${viewport.width}x${viewport.height}.png`,
    });
  }
});

test("mobile motion timeline completes once and offers replay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ height: 812, width: 375 });
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "重新播放示例演示" })).toHaveCount(0);
  await page.locator("[data-demo-shell]").scrollIntoViewIfNeeded();
  const demo = page.locator("[data-demo-stage]");
  const replayButton = demo.getByRole("button", { name: "重新播放示例演示" });
  await expect(demo).toBeVisible();
  await expect(replayButton).toBeHidden();
  await expect(demo).toHaveAttribute("data-demo-stage", "5", { timeout: 11_000 });
  await expect(replayButton).toBeVisible();
});

test("legacy dashboard query redirects before rendering the landing page", async ({ request }) => {
  const response = await request.get("/?view=all&q=C919&utm_source=legacy", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/app\?q=C919&view=all$/);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("final intelligence remains readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { height: 812, width: 375 },
  });
  const page = await context.newPage();

  try {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("别追逐信息");
    const fallback = page.locator("article").filter({ hasText: "示例最终情报" });
    await expect(fallback).toBeVisible();
    await expect(
      fallback.getByRole("heading", { name: "C919 新增商业航线运营数据披露" }),
    ).toBeVisible();
    await expect(fallback.getByText("你的阅读、收藏、忽略与纠偏，会持续调整后续情报。")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("pricing stays public without provisioning a workspace", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const response = await page.goto("/pricing", { waitUntil: "networkidle" });

  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-shell="marketing"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: /从一个主题开始.*按你的关注持续生长/ }),
  ).toBeVisible();
  await expect(page.getByText("自托管模式已解锁全部功能")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/pricing-390x844.png`,
  });
});
