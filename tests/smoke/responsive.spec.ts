import { expect, test, type Page } from "@playwright/test";

interface ViewportAuditResult {
  documentWidth: number;
  overflow: Array<{ className: string; label: string; right: number; tag: string }>;
  smallControls: Array<{ height: number; label: string; tag: string; width: number }>;
  weakPrimaryContrast: Array<{ label: string; ratio: number }>;
  viewportWidth: number;
}

const VIEWPORTS = [
  { height: 780, width: 320 },
  { height: 812, width: 375 },
  { height: 896, width: 414 },
  { height: 1024, width: 768 },
  { height: 900, width: 1024 },
  { height: 900, width: 1440 },
] as const;

test("all app pages stay in frame with touch-sized, readable controls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "The breakpoint matrix already includes mobile sizes.",
  );
  test.setTimeout(120_000);

  const paths = await discoverAppPaths(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);

    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} should load at ${viewport.width}px`).toBeTruthy();
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");

      const audit = await page.evaluate<ViewportAuditResult>(() => {
        const isVisible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };
        const labelFor = (element: Element): string =>
          (
            element.getAttribute("aria-label") ??
            element.textContent ??
            element.getAttribute("title") ??
            element.tagName
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80);
        const rgb = (value: string): [number, number, number] | null => {
          const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          return values?.length === 3
            ? [values[0]!, values[1]!, values[2]!]
            : null;
        };
        const luminance = ([red, green, blue]: [number, number, number]) => {
          const [r, g, b] = [red, green, blue].map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const contrast = (foreground: [number, number, number], background: [number, number, number]) => {
          const foregroundLuminance = luminance(foreground);
          const backgroundLuminance = luminance(background);
          return (
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
          );
        };

        const visibleElements = Array.from(
          document.body.querySelectorAll("*"),
        ).filter(isVisible);
        const overflow = visibleElements
          .filter((element) => !element.closest(".top-nav-links"))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < -1 || rect.right > window.innerWidth + 1;
          })
          .slice(0, 12)
          .map((element) => ({
            className: element.className,
            label: labelFor(element),
            right: Math.round(element.getBoundingClientRect().right),
            tag: element.tagName,
          }));
        const smallControls = Array.from(
          document.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea, a[data-slot="button"], [role="tab"]',
          ),
        )
          .filter(isVisible)
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              height: Math.round(rect.height),
              label: labelFor(element),
              tag: element.tagName,
              width: Math.round(rect.width),
            };
          });
        const weakPrimaryContrast = Array.from(
          document.querySelectorAll('[data-variant="primary"]'),
        )
          .filter(isVisible)
          .map((element) => {
            const style = getComputedStyle(element);
            const foreground = rgb(style.color);
            const background = rgb(style.backgroundColor);
            return foreground && background
              ? {
                  label: labelFor(element),
                  ratio: Number(contrast(foreground, background).toFixed(2)),
                }
              : null;
          })
          .filter(
            (result): result is { label: string; ratio: number } =>
              result !== null && result.ratio < 4.5,
          );

        return {
          documentWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ),
          overflow,
          smallControls,
          weakPrimaryContrast,
          viewportWidth: window.innerWidth,
        };
      });

      expect(
        audit.documentWidth,
        `${path} should not scroll horizontally at ${viewport.width}px`,
      ).toBeLessThanOrEqual(audit.viewportWidth + 1);
      expect(
        audit.overflow,
        `${path} should not contain off-frame elements at ${viewport.width}px`,
      ).toEqual([]);
      expect(
        audit.smallControls,
        `${path} controls should be at least 44px at ${viewport.width}px`,
      ).toEqual([]);
      expect(
        audit.weakPrimaryContrast,
        `${path} primary actions should meet 4.5:1 contrast at ${viewport.width}px`,
      ).toEqual([]);
    }
  }
});

async function discoverAppPaths(page: Page): Promise<string[]> {
  await page.goto("/");
  const eventLinks = page.locator('.intelligence-card-title a[href^="/events/"]');
  const eventHref =
    (await eventLinks.count()) > 0 ? await eventLinks.first().getAttribute("href") : null;

  await page.goto("/topics");
  const topicLinks = page.locator('.topic-list-item-name[href^="/topics/"]');
  const topicHref =
    (await topicLinks.count()) > 0 ? await topicLinks.first().getAttribute("href") : null;

  return [
    "/",
    "/briefings",
    "/saved",
    "/preferences",
    "/sources",
    "/topics",
    "/topics/new",
    topicHref,
    topicHref ? `${topicHref}/edit` : null,
    eventHref,
    "/admin/settings",
  ].filter((path): path is string => Boolean(path));
}
