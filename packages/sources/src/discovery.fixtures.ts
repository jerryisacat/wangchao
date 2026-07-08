import {
  BraveSearchProvider,
  buildTopicSearchQueries,
  discoverFeedCandidatesFromPage,
  extractExternalLinks,
  extractTopicKeywords,
} from "./discovery.js";

export async function runSourceDiscoveryFixtures(): Promise<void> {
  await assertBraveSearchProvider();
  await assertFeedProbe();
  assertExternalLinkExtraction();
  assertTopicQueries();
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
