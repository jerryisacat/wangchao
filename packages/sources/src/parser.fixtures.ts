import { parseRssFeed } from "./index.js";

export function runSourceParserFixtures(): Promise<void> {
  return Promise.all([
    assertContentEncodedExtraction(),
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
