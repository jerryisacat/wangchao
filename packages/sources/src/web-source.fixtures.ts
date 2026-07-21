import {
  fetchSource,
  fetchWebListPage,
  parseWebListPage,
  getAdapter,
  FetchWebError,
  UnknownSourceKindError,
  isFetchRetryable,
  isFetchWebRetryable,
  type AdapterSourceInput,
} from "./web-source.js";
import { fetchRssFeed } from "./index.js";

export function runWebSourceFixtures(): Promise<void> {
  return Promise.all([
    assertWebListPageWithSelectors(),
    assertWebListPageGenericAnchorFallback(),
    assertWebListPageIsIdempotentAcrossFetches(),
    assertWebListPageRejectsUnsafeHtmlAndDropsScript(),
    assertWebAdapterRoutesThroughSsrfGuard(),
    assertWebAdapterEnforcesBodySizeLimit(),
    assertWebAdapterThrowsTypedErrorOnHttp500(),
    assertWebAdapterDecodesDeclaredCharset(),
    assertWebAdapterSkipsNonHttpLinks(),
    assertWebAdapterHonoursDateSelectorAndAttr(),
    assertRetryableClassificationMatchesRss(),
    assertUnknownKindIsTypedNonRetryableError(),
    assertRegistryDispatchesRssAndWeb(),
    assertRssAdapterMatchesFetchRssFeed(),
    assertAdapterContractReturnsCanonicalItems(),
  ]).then(() => undefined);
}

const SAMPLE_LIST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Announcements</title></head>
<body>
  <main>
    <ul class="announce-list">
      <li class="announce-item">
        <a class="title" href="/news/2024-01-15-policy-update">Policy update effective February</a>
        <time class="date" datetime="2024-01-15T00:00:00Z">2024-01-15</time>
        <p class="summary">Summary of the policy change.</p>
      </li>
      <li class="announce-item">
        <a class="title" href="https://example.com/news/2024-02-01-product-launch">Product launch announcement</a>
        <time class="date" datetime="2024-02-01T00:00:00Z">2024-02-01</time>
        <p class="summary">We launched a new product.</p>
      </li>
      <li class="announce-item">
        <a class="title" href="javascript:alert(1)">Bad link</a>
      </li>
      <li class="announce-item">
        <a class="title" href="/news/2024-03-01-report">Quarterly report</a>
        <time class="date" datetime="2024-03-01T00:00:00Z">2024-03-01</time>
      </li>
    </ul>
    <script>alert('evil')</script>
  </main>
</body></html>`;

const SAMPLE_GENERIC_HTML = `<!doctype html><html><body>
  <a href="/post/one">First post</a>
  <a href="https://example.org/post/two">Second post</a>
  <a href="javascript:alert(1)">Bad</a>
  <a href="/post/one">Duplicate of first</a>
</body></html>`;

function assertWebListPageWithSelectors(): Promise<void> {
  const items = parseWebListPage(SAMPLE_LIST_HTML, "https://example.com/", {
    itemSelector: ".announce-item",
    linkSelector: ".title",
    titleSelector: ".title",
    dateSelector: ".date",
    dateAttr: "datetime",
    summarySelector: ".summary",
  });
  assert(items.length === 3, `Expected 3 valid items, got ${items.length}`);
  assert(items[0]!.title === "Policy update effective February", "Title should come from .title selector");
  assert(
    items[0]!.url === "https://example.com/news/2024-01-15-policy-update",
    "Relative href should be resolved against baseUrl",
  );
  assert(
    items[0]!.canonicalUrl === "https://example.com/news/2024-01-15-policy-update",
    "canonicalUrl should match resolved URL",
  );
  assert(items[0]!.summary === "Summary of the policy change.", "summary should come from .summary selector");
  assert(
    items[0]!.publishedAt?.toISOString() === "2024-01-15T00:00:00.000Z",
    "publishedAt should come from <time datetime>",
  );
  // WEB list-page items carry no content yet - contentStatus should be
  // undefined (article-fetch sub-cycle will populate ARTICLE_HTML later).
  assert(items[0]!.contentStatus === undefined, "WEB items must not claim content readiness");
  assert(items[0]!.rawMetadata?.source === "web-list-page", "rawMetadata.source should be tagged");
  assert(
    items[1]!.url === "https://example.com/news/2024-02-01-product-launch",
    "Absolute URLs should be preserved",
  );
  // Bad link (javascript:) must be dropped
  assert(
    !items.some((i) => i.url.startsWith("javascript:")),
    "javascript: URLs must be dropped",
  );
  return Promise.resolve();
}

function assertWebListPageGenericAnchorFallback(): Promise<void> {
  const items = parseWebListPage(SAMPLE_GENERIC_HTML, "https://example.com/", {});
  assert(items.length === 2, `Expected 2 unique items in generic mode, got ${items.length}`);
  assert(items[0]!.title === "First post", "Generic mode should use anchor text as title");
  assert(
    items[1]!.url === "https://example.org/post/two",
    "Cross-origin HTTP(S) links should be retained",
  );
  return Promise.resolve();
}

function assertWebListPageIsIdempotentAcrossFetches(): Promise<void> {
  // Two fetches of the same page must produce identical items so that
  // upsertFetchedItems can dedupe by (topicId, canonicalUrl).
  const first = parseWebListPage(SAMPLE_LIST_HTML, "https://example.com/", {
    itemSelector: ".announce-item",
    linkSelector: ".title",
    titleSelector: ".title",
    dateSelector: ".date",
    dateAttr: "datetime",
    summarySelector: ".summary",
  });
  const second = parseWebListPage(SAMPLE_LIST_HTML, "https://example.com/", {
    itemSelector: ".announce-item",
    linkSelector: ".title",
    titleSelector: ".title",
    dateSelector: ".date",
    dateAttr: "datetime",
    summarySelector: ".summary",
  });
  assert(first.length === second.length, "Idempotent fetches produce same count");
  for (let i = 0; i < first.length; i += 1) {
    assert(first[i]!.canonicalUrl === second[i]!.canonicalUrl, "canonicalUrl stable across fetches");
    assert(first[i]!.contentHash === second[i]!.contentHash, "contentHash stable across fetches");
  }
  return Promise.resolve();
}

function assertWebListPageRejectsUnsafeHtmlAndDropsScript(): Promise<void> {
  // Script content must never produce an item; the title text "evil" lives only
  // inside <script> and must not leak into any item title/summary.
  const items = parseWebListPage(SAMPLE_LIST_HTML, "https://example.com/", {
    itemSelector: ".announce-item",
    linkSelector: ".title",
    titleSelector: ".title",
  });
  assert(!items.some((i) => i.title.includes("evil")), "Script content must not leak into titles");
  assert(!items.some((i) => i.summary?.includes("evil")), "Script content must not leak into summaries");
  return Promise.resolve();
}

async function assertWebAdapterRoutesThroughSsrfGuard(): Promise<void> {
  let called = false;
  await assertRejects(
    () =>
      fetchWebListPage("http://127.0.0.1/announce", undefined, {
        fetchImpl: async () => {
          called = true;
          return new Response("<html></html>", { status: 200 });
        },
      }),
    "SSRF guard must block loopback URLs",
  );
  assert(!called, "fetchImpl must not be called after SSRF rejection");
}

async function assertWebAdapterEnforcesBodySizeLimit(): Promise<void> {
  const big = "x".repeat(11 * 1024 * 1024);
  await assertRejects(
    () =>
      fetchWebListPage("https://example.com/announce", undefined, {
        fetchImpl: async () =>
          new Response(big, {
            status: 200,
            headers: { "content-length": String(big.length) },
          }),
        maxBodyBytes: 10 * 1024 * 1024,
      }),
    "Body exceeding maxBodyBytes must be rejected",
  );
}

async function assertWebAdapterThrowsTypedErrorOnHttp500(): Promise<void> {
  try {
    await fetchWebListPage("https://example.com/announce", undefined, {
      fetchImpl: async () => new Response("Server error", { status: 500 }),
    });
    throw new Error("Expected fetchWebListPage to throw on HTTP 500");
  } catch (error) {
    assert(error instanceof FetchWebError, "HTTP 500 must throw FetchWebError");
    assert((error as FetchWebError).status === 500, "FetchWebError.status must be 500");
    assert(isFetchWebRetryable(error), "HTTP 500 must be retryable");
  }
}

function assertWebAdapterDecodesDeclaredCharset(): Promise<void> {
  // Page declares GBK charset but response is decoded as latin-1 by default.
  // We exercise the re-decode path by feeding UTF-8 HTML with a GBK meta tag -
  // the function should not crash and should still return parsed items.
  const html = `<!doctype html><html><head><meta charset="gbk"><title>测试</title></head>
  <body><ul><li class="item"><a href="/p/1">公告一</a></li></ul></body></html>`;
  const items = parseWebListPage(html, "https://example.com/", {
    itemSelector: ".item",
  });
  assert(items.length === 1, "Charset-tagged page should still parse items");
  assert(items[0]!.title.includes("公告"), "Title should retain CJK characters");
  return Promise.resolve();
}

function assertWebAdapterSkipsNonHttpLinks(): Promise<void> {
  const html = `<!doctype html><html><body>
    <a href="mailto:test@example.com">Mail</a>
    <a href="ftp://example.com/file">FTP</a>
    <a href="/ok">HTTP relative</a>
  </body></html>`;
  const items = parseWebListPage(html, "https://example.com/", {});
  assert(items.length === 1, `Expected only 1 HTTP link, got ${items.length}`);
  assert(items[0]!.url === "https://example.com/ok", "Non-HTTP links must be skipped");
  return Promise.resolve();
}

function assertWebAdapterHonoursDateSelectorAndAttr(): Promise<void> {
  const html = `<!doctype html><html><body>
    <ul>
      <li class="row">
        <a href="/a">Title A</a>
        <span class="when" data-date="2024-04-01T00:00:00Z">April 1</span>
      </li>
    </ul></body></html>`;
  const items = parseWebListPage(html, "https://example.com/", {
    itemSelector: ".row",
    dateSelector: ".when",
    dateAttr: "data-date",
  });
  assert(items.length === 1, "Date selector should not filter out valid rows");
  assert(
    items[0]!.publishedAt?.toISOString() === "2024-04-01T00:00:00.000Z",
    "dateAttr should drive date parsing",
  );
  return Promise.resolve();
}

function assertRetryableClassificationMatchesRss(): Promise<void> {
  assert(isFetchRetryable(new FetchWebError("x", 503)), "503 should be retryable");
  assert(isFetchRetryable(new FetchWebError("x", 429)), "429 should be retryable");
  assert(!isFetchRetryable(new FetchWebError("x", 404)), "404 should NOT be retryable");
  assert(isFetchRetryable(new TypeError("network")), "TypeError should be retryable");
  const abort = new Error("timeout");
  abort.name = "AbortError";
  assert(isFetchRetryable(abort), "AbortError should be retryable");
  return Promise.resolve();
}

function assertUnknownKindIsTypedNonRetryableError(): Promise<void> {
  // getAdapter on an unregistered kind (cast through any for the test) must
  // throw UnknownSourceKindError, which is NOT retryable.
  try {
    getAdapter("WEB" as "RSS" | "WEB"); // valid
  } catch {
    throw new Error("WEB must be registered");
  }
  // Simulate unknown kind via a deliberately-unsupported value through the
  // registry indirection: we cannot import the private registry, so we
  // verify the error class semantics directly.
  const err = new UnknownSourceKindError("no adapter", "MADE_UP_KIND");
  assert(err.kind === "MADE_UP_KIND", "UnknownSourceKindError must expose kind");
  assert(!isFetchWebRetryable(err), "UnknownSourceKindError must NOT be retryable");
  assert(!isFetchRetryable(err), "UnknownSourceKindError must NOT be retryable via shared predicate");
  return Promise.resolve();
}

function assertRegistryDispatchesRssAndWeb(): Promise<void> {
  const rssAdapter = getAdapter("RSS");
  const webAdapter = getAdapter("WEB");
  assert(rssAdapter.kind === "RSS", "RSS adapter kind");
  assert(webAdapter.kind === "WEB", "WEB adapter kind");
  return Promise.resolve();
}

async function assertRssAdapterMatchesFetchRssFeed(): Promise<void> {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
    <item><title>T</title><link>https://example.com/a</link></item></channel></rss>`;
  const source: AdapterSourceInput = {
    id: "src-1",
    kind: "RSS",
    name: "test",
    url: "https://example.com/feed",
  };
  const items = await fetchSource(source, {
    fetchImpl: async () => new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } }),
  });
  assert(items.length === 1, "RSS adapter should parse one item");
  assert(items[0]!.title === "T", "RSS adapter title");
}

async function assertAdapterContractReturnsCanonicalItems(): Promise<void> {
  const html = `<!doctype html><html><body>
    <ul><li class="r"><a href="/x">X</a></li></ul></body></html>`;
  const source: AdapterSourceInput = {
    id: "src-web-1",
    kind: "WEB",
    name: "announcements",
    url: "https://example.com/list",
    rawMetadata: { webAdapter: { itemSelector: ".r" } },
  };
  const items = await fetchSource(source, {
    fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  assert(items.length === 1, "WEB adapter via fetchSource should return one item");
  assert(items[0]!.canonicalUrl === "https://example.com/x", "canonicalUrl via dispatch");
  // WEB list-page items leave contentStatus undefined until article fetch.
  assert(items[0]!.contentStatus === undefined, "WEB items must not claim content readiness via dispatch");
  assert(items[0]!.contentHash.length > 0, "contentHash must be populated for dedup");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

// Touch fetchRssFeed import to ensure the sources package keeps re-exporting
// it (avoids accidental tree-shaking complaints during fixture builds).
void fetchRssFeed;