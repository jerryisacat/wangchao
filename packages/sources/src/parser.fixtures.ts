import { fetchArticleMarkdown, htmlToSafeMarkdown, parseRssFeed } from "./index.js";

export function runSourceParserFixtures(): Promise<void> {
  return Promise.all([
    assertContentEncodedExtraction(),
    assertArticleMarkdownExtraction(),
    assertUnsupportedPlatformSkipsNetwork(),
    assertUnsafeHtmlIsRemoved(),
    assertAtomAlternateLink(),
    assertNumericEntityDecoding(),
    assertCdataHandling(),
    assertEmptyFeed(),
    assertAtomPublishedFallback(),
  ]).then(() => undefined);
}

function assertContentEncodedExtraction(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>Article</title>
          <link>https://example.com/article</link>
          <description>Short description</description>
          <content:encoded><![CDATA[<p>Full HTML content here</p>]]></content:encoded>
        </item>
      </channel>
    </rss>`;
  const items = parseRssFeed(xml);
  assert(items.length === 1, "Should parse one item.");
  assert(
    items[0]?.summary === "<p>Full HTML content here</p>",
    "Should prefer content:encoded over description.",
  );
  assert(
    items[0]?.rawContent === "Full HTML content here",
    "content:encoded should be retained as Markdown.",
  );
  assert(items[0]?.contentStatus === "READY", "Embedded RSS content should be ready.");
  assert(items[0]?.contentSource === "RSS_EMBEDDED", "Embedded RSS source should be recorded.");
  return Promise.resolve();
}

async function assertArticleMarkdownExtraction(): Promise<void> {
  const html = `<!doctype html><html><body><main><article>
    <h1>Useful article</h1>
    <p>This paragraph contains enough meaningful content for Readability to identify the page as an article.</p>
    <p>It also links to <a href="/evidence">supporting evidence</a> and keeps the document auditable.</p>
  </article></main></body></html>`;
  const result = await fetchArticleMarkdown("https://93.184.216.34/article", {
    fetchImpl: async () => new Response(html, {
      headers: { "content-type": "text/html" },
      status: 200,
    }),
  });
  assert(result.status === "READY", `Expected READY article, received ${result.status}.`);
  assert(result.markdown?.includes("Useful article") === true, "Article title should survive Markdown conversion.");
  assert(result.markdown?.includes("[supporting evidence](https://93.184.216.34/evidence)") === true, "Safe links should be absolute and retained.");
}

async function assertUnsupportedPlatformSkipsNetwork(): Promise<void> {
  let called = false;
  const result = await fetchArticleMarkdown("https://x.com/example/status/123", {
    fetchImpl: async () => {
      called = true;
      return new Response("unexpected");
    },
  });
  assert(result.status === "UNSUPPORTED", "X should be explicitly unsupported until its adapter is implemented.");
  assert(result.errorCode === "PLATFORM_NOT_SUPPORTED", "Unsupported platforms need a stable error code.");
  assert(!called, "Unsupported platform URLs must not invoke the generic fetcher.");
}

function assertUnsafeHtmlIsRemoved(): Promise<void> {
  const markdown = htmlToSafeMarkdown(
    `<p onclick="steal()">Safe text <a href="javascript:alert(1)">bad link</a> [literal](javascript:alert(2))</p><script>alert(1)</script><style>body{display:none}</style>`,
    "https://example.com",
  );
  assert(markdown.includes("Safe text bad link"), "Visible safe text should remain.");
  assert(!markdown.includes("javascript:"), "javascript URLs and literal Markdown link payloads must be neutralized.");
  assert(!markdown.includes("alert(1)"), "Script contents must be removed.");
  assert(!markdown.includes("display:none"), "Style contents must be removed.");
  return Promise.resolve();
}

function assertAtomAlternateLink(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <entry>
        <title>Entry</title>
        <link rel="self" href="https://example.com/atom.xml"/>
        <link rel="alternate" href="https://example.com/entry"/>
        <id>urn:uuid:123</id>
      </entry>
    </feed>`;
  const items = parseRssFeed(xml);
  assert(items.length === 1, "Should parse one Atom entry.");
  assert(
    items[0]?.url === "https://example.com/entry",
    "Should prefer rel=alternate link for Atom.",
  );
  return Promise.resolve();
}

function assertNumericEntityDecoding(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test</title>
        <item>
          <title>Entity &#123;test&#x7B;case</title>
          <link>https://example.com/entity</link>
        </item>
      </channel>
    </rss>`;
  const items = parseRssFeed(xml);
  assert(items.length === 1, "Should parse one item.");
  assert(
    items[0]?.title === "Entity {test{case",
    "Should decode numeric character references.",
  );
  return Promise.resolve();
}

function assertCdataHandling(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test</title>
        <item>
          <title><![CDATA[CDATATitle]]></title>
          <link>https://example.com/cdata</link>
          <description><![CDATA[CDATA description with <b>tags</b>]]></description>
        </item>
      </channel>
    </rss>`;
  const items = parseRssFeed(xml);
  assert(items.length === 1, "Should parse one item.");
  assert(items[0]?.title === "CDATATitle", "Should strip CDATA from title.");
  assert(
    items[0]?.summary === "CDATA description with <b>tags</b>",
    "Should strip CDATA from description.",
  );
  return Promise.resolve();
}

function assertEmptyFeed(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Empty</title>
      </channel>
    </rss>`;
  const items = parseRssFeed(xml);
  assert(items.length === 0, "Should return empty array for feed with no items.");
  return Promise.resolve();
}

function assertAtomPublishedFallback(): Promise<void> {
  const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom</title>
      <entry>
        <title>Entry</title>
        <link href="https://example.com/atom-entry"/>
        <updated>2024-01-15T10:30:00Z</updated>
        <id>urn:uuid:456</id>
      </entry>
    </feed>`;
  const items = parseRssFeed(xml);
  assert(items.length === 1, "Should parse one Atom entry.");
  assert(
    items[0]?.publishedAt?.toISOString() === "2024-01-15T10:30:00.000Z",
    "Should fall back to updated when published is missing.",
  );
  return Promise.resolve();
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
