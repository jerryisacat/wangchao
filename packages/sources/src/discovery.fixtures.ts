import {
  BraveSearchProvider,
  buildTopicSearchQueries,
  createSearchProvider,
  discoverFeedCandidatesFromPage,
  extractExternalLinks,
  extractTopicKeywords,
  SearXngSearchProvider,
  SerperSearchProvider,
  TavilySearchProvider,
} from "./discovery.js";
import { validateRssFeedUrl } from "./index.js";

export async function runSourceDiscoveryFixtures(): Promise<void> {
  await assertBraveSearchProvider();
  await assertTavilySearchProvider();
  await assertSerperSearchProvider();
  await assertSearXngSearchProvider();
  await assertFeedProbe();
  await assertFeedValidation();
  assertExternalLinkExtraction();
  assertTopicQueries();
  assertSearchProviderFactory();
}

async function assertBraveSearchProvider(): Promise<void> {
  const provider = new BraveSearchProvider({
    apiKey: "fixture-key",
    fetchImpl: async (input) => {
      const url = String(input);
      assert(url.includes("q=ai+policy"), "Brave query should be encoded.");
      return jsonResponse({
        web: {
          results: [
            {
              description: "Policy announcements",
              title: "Policy Feed",
              url: "https://example.com/feed.xml",
            },
            {
              title: "Unsafe",
              url: "javascript:alert(1)",
            },
          ],
        },
      });
    },
  });
  const results = await provider.searchSources("ai policy");

  assert(results.length === 1, "Brave provider should drop non-HTTP URLs.");
  assert(results[0]?.url === "https://example.com/feed.xml", "Brave URL should match.");
}

async function assertTavilySearchProvider(): Promise<void> {
  const provider = new TavilySearchProvider({
    apiKey: "fixture-key",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      assert(body.query === "ai policy", "Tavily should send query in POST body.");
      assert(body.api_key === "fixture-key", "Tavily should include API key in body.");
      return jsonResponse({
        results: [
          {
            content: "AI policy content",
            title: "Policy Result",
            url: "https://example.com/policy",
          },
        ],
      });
    },
  });
  const results = await provider.searchSources("ai policy");
  assert(results.length === 1, "Tavily should return one result.");
  assert(results[0]?.url === "https://example.com/policy", "Tavily URL should match.");
  assert(results[0]?.snippet === "AI policy content", "Tavily snippet should match.");
}

async function assertSerperSearchProvider(): Promise<void> {
  const provider = new SerperSearchProvider({
    apiKey: "fixture-key",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      assert(body.q === "tech news", "Serper should send query in body.");
      assert(
        (init?.headers as Record<string, string>)["X-API-KEY"] === "fixture-key",
        "Serper should send API key in header.",
      );
      return jsonResponse({
        organic: [
          {
            link: "https://example.com/tech",
            snippet: "Tech snippet",
            title: "Tech News",
          },
        ],
      });
    },
  });
  const results = await provider.searchSources("tech news");
  assert(results.length === 1, "Serper should return one result.");
  assert(results[0]?.url === "https://example.com/tech", "Serper URL should match.");
}

async function assertSearXngSearchProvider(): Promise<void> {
  const provider = new SearXngSearchProvider({
    baseUrl: "https://search.example.com",
    fetchImpl: async (input) => {
      const url = String(input);
      assert(url.includes("format=json"), "SearXNG should request JSON format.");
      assert(url.includes("q=open+source"), "SearXNG should encode query.");
      return jsonResponse({
        results: [
          {
            content: "Open source content",
            title: "OS Result",
            url: "https://example.com/os",
          },
        ],
      });
    },
  });
  const results = await provider.searchSources("open source", { count: 3 });
  assert(results.length === 1, "SearXNG should return one result.");
  assert(results[0]?.url === "https://example.com/os", "SearXNG URL should match.");
}

async function assertFeedProbe(): Promise<void> {
  const candidates = await discoverFeedCandidatesFromPage("https://example.com/news", {
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === "https://example.com/news") {
        return textResponse(
          `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
          "text/html",
          url,
        );
      }

      if (url === "https://example.com/feed.xml") {
        return textResponse(
          `<?xml version="1.0"?><rss><channel><title>Example Updates</title></channel></rss>`,
          "application/rss+xml",
          url,
        );
      }

      return textResponse("<html></html>", "text/html", url);
    },
  });

  assert(candidates.length === 1, "Feed probe should find rel=alternate feed.");
  assert(candidates[0]?.name === "Example Updates", "Feed probe should read feed title.");
}

async function assertFeedValidation(): Promise<void> {
  const feed = await validateRssFeedUrl("https://example.com/feed.xml", {
    fetchImpl: async (input) =>
      textResponse(
        `<?xml version="1.0"?><rss><channel><title>Validated Feed</title><item><title>Item</title><link>https://example.com/a</link></item></channel></rss>`,
        "application/rss+xml",
        String(input),
      ),
  });

  assert(feed.title === "Validated Feed", "Feed validation should read feed title.");
  assert(feed.itemCount === 1, "Feed validation should count items.");

  await assertRejects(
    () =>
      validateRssFeedUrl("fixture://example", {
        fetchImpl: async () =>
          textResponse(
            `<?xml version="1.0"?><rss><channel><title>Bad</title></channel></rss>`,
            "application/rss+xml",
            "fixture://example",
          ),
      }),
    "Feed validation should reject non-HTTP URLs.",
  );

  await assertRejects(
    () =>
      validateRssFeedUrl("https://example.com/no-title.xml", {
        fetchImpl: async (input) =>
          textResponse(
            `<?xml version="1.0"?><rss><channel><item><title>Item</title><link>https://example.com/a</link></item></channel></rss>`,
            "application/rss+xml",
            String(input),
          ),
      }),
    "Feed validation should require feed title.",
  );
}

function assertExternalLinkExtraction(): void {
  const links = extractExternalLinks(
    `<a href="/internal">internal</a><a href="https://source.example/feed">feed</a><img src="https://cdn.example/a.png">`,
    "https://example.com/post",
  );

  assert(links.includes("https://source.example/feed"), "External href should be extracted.");
  assert(links.includes("https://cdn.example/a.png"), "External src should be extracted.");
  assert(!links.includes("https://example.com/internal"), "Same-domain links should be filtered.");
}

function assertTopicQueries(): void {
  const keywords = extractTopicKeywords({ keywords: ["AI", " policy ", 123] });
  const queries = buildTopicSearchQueries({
    keywords,
    topicName: "AI Regulation",
  });

  assert(keywords.join(",") === "AI,policy", "Topic profile keywords should be sanitized.");
  assert(queries.includes("AI Regulation RSS"), "Topic name RSS query should exist.");
  assert(queries.includes("policy announcements"), "Keyword announcement query should exist.");
}

function assertSearchProviderFactory(): void {
  const brave = createSearchProvider("brave", { apiKey: "key" });
  assert(brave instanceof BraveSearchProvider, "Factory should create BraveSearchProvider.");

  const tavily = createSearchProvider("tavily", { apiKey: "key" });
  assert(tavily instanceof TavilySearchProvider, "Factory should create TavilySearchProvider.");

  const serper = createSearchProvider("serper", { apiKey: "key" });
  assert(serper instanceof SerperSearchProvider, "Factory should create SerperSearchProvider.");

  const searxng = createSearchProvider("searxng", { baseUrl: "http://localhost:8080" });
  assert(searxng instanceof SearXngSearchProvider, "Factory should create SearXngSearchProvider.");

  const noKey = createSearchProvider("brave", {});
  assert(noKey === null, "Factory should return null when no API key.");

  const searxngNoUrl = createSearchProvider("searxng", {});
  assert(searxngNoUrl === null, "Factory should return null when no base URL for searxng.");
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
    status: 200,
  });
}

function textResponse(body: string, contentType: string, url: string): Response {
  const response = new Response(body, {
    headers: {
      "content-type": contentType,
    },
    status: 200,
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }

  throw new Error(message);
}
