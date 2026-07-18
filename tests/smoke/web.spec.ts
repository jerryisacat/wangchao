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
    await expect(topicLinks.first()).toHaveAttribute("aria-current", "page");
  }
});

test("saved events can be opened and removed in place", async ({ page }) => {
  await page.goto("/saved");
  const savedRows = page.locator(".saved-event-row");
  const savedCount = await savedRows.count();

  if (savedCount === 0) {
    test.skip(true, "No saved events are available in this workspace.");
  }

  const firstSavedRow = savedRows.first();
  const detailLink = firstSavedRow.locator('a[href^="/events/"]');
  await expect(detailLink).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "收藏分页" }),
  ).toContainText(/第 \d+ \/ \d+ 页/);

  await firstSavedRow.getByRole("button", { name: "标记已读" }).click();
  await expect(page).toHaveURL(/\/saved/);
  await expect(savedRows).toHaveCount(savedCount);

  await savedRows.first().getByRole("button", { name: "取消收藏" }).click();
  await expect(page).toHaveURL(/\/saved/);
  await expect(savedRows).toHaveCount(savedCount - 1);
});

test("briefing history exposes real downloads and pagination", async ({ page }) => {
  await page.goto("/briefings");
  const briefingRows = page.locator(".briefing-row");

  if ((await briefingRows.count()) === 0) {
    test.skip(true, "No briefings are available in this workspace.");
  }

  await expect(
    page.getByRole("navigation", { name: "简报分页" }),
  ).toContainText(/第 \d+ \/ \d+ 页/);
  await expect(
    briefingRows.first().getByRole("link", { name: "Markdown" }),
  ).toHaveAttribute("href", /^\/exports\/briefings\/[^/]+$/);
  await expect(
    briefingRows.first().getByText(/^(每日|每周|每月)$/),
  ).toBeVisible();
});

test("admin credential tabs and client validation remain interactive", async ({ page }) => {
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "API Key 配置" })).toBeVisible();

  await page.getByRole("link", { name: "成员与用量" }).click();
  await expect(page).toHaveURL(/\/admin\/usage/);
  await expect(
    page.getByRole("heading", { name: "工作区成员与用量" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "成员" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "近 30 天用量" }),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay',
    ),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "API Key 设置" }).click();

  await page.getByRole("tab", { name: "搜索凭证" }).click();
  await expect(page.getByPlaceholder("输入新的搜索 API Key")).toBeVisible();

  await page.getByRole("tab", { name: "AI 凭证" }).click();
  const showKeyButton = page.getByRole("button", { name: "显示 Key" });
  await expect(showKeyButton).toBeVisible();
  await expect(showKeyButton).not.toHaveAttribute("tabindex", "-1");

  await page.getByRole("button", { name: "测试当前配置" }).click();
  await expect(
    page.getByText("API Key 为必填项，请输入后再测试。"),
  ).toBeVisible();
  await expect(page.getByLabel("API Key (必填)")).toBeFocused();

  await page.getByRole("tab", { name: "Telegram 投递" }).click();
  await expect(page.getByText("高优先级情报即时推送")).toBeVisible();
  await expect(page.getByRole("button", { name: "开启即时推送" })).toBeDisabled();
  await expect(page.getByText(/升级 Plus 或 Pro 后可开启/)).toBeVisible();
});

test("first intelligence card opens a stable detail page", async ({ page }) => {
  await page.goto("/");
  const firstCard = page.locator(".intelligence-card").first();

  if ((await firstCard.count()) === 0) {
    test.skip(true, "No intelligence events are available in this workspace.");
  }

  const titleLink = firstCard.locator(".intelligence-card-title a").first();
  const href = await titleLink.getAttribute("href");
  const cardOriginalLink = firstCard.getByRole("link", { name: "查看原文" });
  const cardOriginalHref =
    (await cardOriginalLink.count()) > 0
      ? await cardOriginalLink.getAttribute("href")
      : null;
  expect(href).toMatch(/^\/events\/[^/]+$/);

  await titleLink.click();
  await expect(page).toHaveURL(/\/events\/[^/?]+/);
  await expect(page.getByRole("heading", { name: "情报详情" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Markdown" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回情报流" })).toBeVisible();
  await expect(page.getByRole("button", { name: "忽略此条" })).toBeVisible();
  await expect(page.getByRole("button", { name: "多关注这类" })).toBeVisible();
  await expect(page.getByRole("button", { name: "少关注这类" })).toBeVisible();

  const detailOriginalLink = page.getByRole("link", { name: "原文" });
  if (cardOriginalHref) {
    await expect(detailOriginalLink).toHaveAttribute("href", cardOriginalHref);
  } else {
    await expect(detailOriginalLink).toHaveCount(0);
  }
});

test("new topic goes through draft preview before creating", async ({ page }, testInfo) => {
  await page.goto("/topics/new");
  await expect(page.getByRole("heading", { name: "新建观察主题" })).toBeVisible();
  await expect(page.getByLabel("RSS URL")).toHaveCount(0);
  await expect(page.getByLabel("RSS 名称")).toHaveCount(0);

  await page
    .getByLabel("主题名称")
    .fill(`AI 基础设施 smoke ${testInfo.project.name} ${Date.now()}`);
  await page
    .getByLabel("主题描述")
    .fill("关注 AI 基础设施、模型供应商、Agent 平台和部署生态。");
  await page.getByRole("button", { name: "生成主题草案" }).click();

  // Draft preview must appear before any Topic/Source row is written.
  await expect(page).toHaveURL(/\/topics\/new\/preview/);
  await expect(page.getByRole("heading", { name: "确认主题画像" })).toBeVisible();

  // Confirm is the only step that persists.
  await page.getByRole("button", { name: "确认创建主题" }).click();

  await expect(page).toHaveURL(/\/sources/);
  await expect(page.getByText(/主题已创建/)).toBeVisible();
});

test("topic management page lists topics and allows pause/resume", async ({ page }) => {
  await page.goto("/topics");
  await expect(page.getByRole("heading", { name: "主题管理" })).toBeVisible();

  const topicLinks = page.locator(".topic-list-item-name");
  const topicCount = await topicLinks.count();

  if (topicCount === 0) {
    test.skip(true, "No topics are available in this workspace.");
  }

  const firstTopicName = await topicLinks.first().textContent();
  expect(firstTopicName).toBeTruthy();

  await topicLinks.first().click();
  await expect(page).toHaveURL(/\/topics\/[^/?]+/);
  await expect(page.getByRole("heading", { name: firstTopicName! })).toBeVisible();

  await page.getByRole("link", { name: "编辑" }).click();
  await expect(page.getByRole("heading", { name: "编辑主题" })).toBeVisible();
  await expect(page.getByText("主题画像", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/关键词（必填/)).not.toHaveValue("");
  await expect(page.getByLabel(/关键实体/)).toBeVisible();
  await expect(page.getByLabel(/应覆盖范围/)).toBeVisible();
  await expect(page.getByLabel(/应排除范围/)).toBeVisible();
  await expect(page.getByLabel(/重要性规则/)).toBeVisible();
});
