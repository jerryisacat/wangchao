import { expect, test } from "@playwright/test";

test("dashboard search and filters keep URL state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "未读情报" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "搜索情报" });
  await search.fill("OpenAI");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=OpenAI/);

  await page.getByRole("link", { name: "高价值" }).click();
  await expect(page).toHaveURL(/q=OpenAI/);
  await expect(page).toHaveURL(/view=high/);

  const topicLinks = page.locator(".topic-filter-item").filter({ hasNotText: "全部主题" });
  const topicCount = await topicLinks.count();

  if (topicCount > 0) {
    await topicLinks.first().click();
    await expect(page).toHaveURL(/q=OpenAI/);
    await expect(page).toHaveURL(/view=high/);
    await expect(topicLinks.first()).toHaveAttribute("aria-selected", "true");
  }
});

test("first intelligence card opens a stable detail page", async ({ page }) => {
  await page.goto("/");
  const firstCard = page.locator(".intelligence-card").first();

  if ((await firstCard.count()) === 0) {
    test.skip(true, "No intelligence events are available in this workspace.");
  }

  const titleLink = firstCard.locator(".intelligence-card-title a").first();
  const href = await titleLink.getAttribute("href");
  expect(href).toMatch(/^\/events\/[^/]+$/);

  await titleLink.click();
  await expect(page).toHaveURL(/\/events\/[^/?]+/);
  await expect(page.getByRole("heading", { name: "情报详情" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Markdown" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回情报流" })).toBeVisible();
});
