import { fetchSourceItemsForKind } from "./fetch.js";
import { FetchWebError, UnknownSourceKindError, isFetchRetryable } from "@wangchao/sources";
import type { FetchedSourceRecord } from "@wangchao/db";

export async function runFetchDispatchFixtures(): Promise<void> {
  await assertWebSourceDispatchedThroughWebAdapter();
  await assertRssSourceDispatchedThroughRssAdapter();
  await assertUnknownKindThrowsTypedNonRetryableError();
  await assertLegacySourceWithoutKindDefaultsToRss();
  await assertWebAdapterHttpErrorPropagatesAsFetchWebError();
}

const RSS_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
  <item><title>RSS item</title><link>https://example.com/rss/a</link></item></channel></rss>`;

const WEB_HTML = `<!doctype html><html><body>
  <ul><li class="r"><a href="/w">WEB item</a></li></ul></body></html>`;

async function assertWebSourceDispatchedThroughWebAdapter(): Promise<void> {
  const source: FetchedSourceRecord = {
    id: "src-web",
    organizationId: "org-1",
    topicId: "topic-1",
    name: "Announcements",
    url: "https://example.com/list",
    kind: "WEB",
  };
  const items = await fetchSourceItemsForKind(source, {
    fetchImpl: async () =>
      new Response(WEB_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
  assert(items.length === 1, `Expected 1 WEB item, got ${items.length}`);
  assert(items[0]!.title === "WEB item", "WEB adapter title");
  assert(items[0]!.url === "https://example.com/w", "WEB adapter resolved URL");
  assert(items[0]!.canonicalUrl === "https://example.com/w", "WEB adapter canonicalUrl");
}

async function assertRssSourceDispatchedThroughRssAdapter(): Promise<void> {
  const source: FetchedSourceRecord = {
    id: "src-rss",
    organizationId: "org-1",
    topicId: "topic-1",
    name: "RSS feed",
    url: "https://example.com/feed",
    kind: "RSS",
  };
  const items = await fetchSourceItemsForKind(source, {
    fetchImpl: async () =>
      new Response(RSS_XML, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
  });
  assert(items.length === 1, `Expected 1 RSS item, got ${items.length}`);
  assert(items[0]!.title === "RSS item", "RSS adapter title");
  assert(items[0]!.url === "https://example.com/rss/a", "RSS adapter URL");
}

async function assertUnknownKindThrowsTypedNonRetryableError(): Promise<void> {
  // Cast through unknown to simulate a future enum value that no adapter is
  // registered for. The dispatch must surface a typed, NON-retryable error
  // so the retry loop stops immediately and the TaskRun records it.
  const source = {
    id: "src-x",
    organizationId: "org-1",
    topicId: "topic-1",
    name: "future",
    url: "https://example.com/future",
    kind: "EMAIL" as "RSS" | "WEB",
  } as FetchedSourceRecord;

  let caught: unknown;
  try {
    await fetchSourceItemsForKind(source);
    throw new Error("Expected fetchSourceItemsForKind to throw on unknown kind");
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, "Unknown kind must throw an Error");
  // UnknownSourceKindError is thrown by the adapter registry; we assert via
  // name rather than instanceof to avoid importing private internals.
  assert(
    caught instanceof UnknownSourceKindError || caught.name === "UnknownSourceKindError",
    "Unknown kind must surface as UnknownSourceKindError",
  );
  assert(!isFetchRetryable(caught), "UnknownSourceKindError must be non-retryable");
}

async function assertLegacySourceWithoutKindDefaultsToRss(): Promise<void> {
  // Sources that pre-date the kind column (or stale code paths that omit it)
  // must default to RSS so existing RSS sources keep working.
  const source: FetchedSourceRecord = {
    id: "src-legacy",
    organizationId: "org-1",
    topicId: "topic-1",
    name: "Legacy",
    url: "https://example.com/feed",
  };
  const items = await fetchSourceItemsForKind(source, {
    fetchImpl: async () =>
      new Response(RSS_XML, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
  });
  assert(items.length === 1, "Legacy (kind undefined) must route to RSS adapter");
  assert(items[0]!.title === "RSS item", "Legacy dispatch title");
}

async function assertWebAdapterHttpErrorPropagatesAsFetchWebError(): Promise<void> {
  const source: FetchedSourceRecord = {
    id: "src-web-fail",
    organizationId: "org-1",
    topicId: "topic-1",
    name: "Failing announcements",
    url: "https://example.com/list",
    kind: "WEB",
  };
  let caught: unknown;
  try {
    await fetchSourceItemsForKind(source, {
      fetchImpl: async () => new Response("Internal Server Error", { status: 500 }),
    });
    throw new Error("Expected WEB HTTP 500 to throw");
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof FetchWebError, "HTTP 500 must surface as FetchWebError");
  assert((caught as FetchWebError).status === 500, "FetchWebError.status must be 500");
  assert(isFetchRetryable(caught), "HTTP 500 must be retryable");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}