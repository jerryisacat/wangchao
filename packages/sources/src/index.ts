export type SourceKind = "rss" | "web";

export {
  BraveSearchProvider,
  buildTopicSearchQueries,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinks,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  type FeedCandidate,
  type FeedProbeOptions,
  type SearchProvider,
  type SearchResult,
  type SearchSourcesOptions,
} from "./discovery.js";

export interface SourceAdapterDescriptor {
  kind: SourceKind;
  longRunning: true;
}

export interface NormalizedSourceItem {
  title: string;
  url: string;
  canonicalUrl: string;
  summary?: string;
  author?: string;
  publishedAt?: Date;
  contentHash: string;
  rawMetadata: Record<string, unknown>;
}

export interface FetchRssFeedOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class FetchRssError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FetchRssError";
  }
}

export function isFetchRssRetryable(error: unknown): boolean {
  if (error instanceof FetchRssError) {
    return (
      error.status === undefined ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof TypeError)
  );
}

export interface RssFeedValidationResult {
  itemCount: number;
  title: string;
  url: string;
}

export const rssSourceAdapter: SourceAdapterDescriptor = {
  kind: "rss",
  longRunning: true,
};

export async function fetchRssFeed(
  feedUrl: string,
  options: FetchRssFeedOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(feedUrl, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "WangchaoWorker/1.0 RSS fetcher",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new FetchRssError(`RSS fetch failed with HTTP ${response.status}`, response.status);
    }

    try {
      return parseRssFeed(await response.text());
    } catch (parseError) {
      throw new FetchRssError(
        parseError instanceof Error ? parseError.message : "RSS feed parsing failed",
        undefined,
        parseError,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateRssFeedUrl(
  feedUrl: string,
  options: FetchRssFeedOptions = {},
): Promise<RssFeedValidationResult> {
  const parsedUrl = new URL(feedUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("RSS validation only accepts HTTP/HTTPS URLs.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(feedUrl, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "WangchaoSourceValidator/1.0 RSS validator",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS validation failed with HTTP ${response.status}`);
    }

    const xml = await response.text();
    if (!/<(rss|feed)\b/i.test(xml)) {
      throw new Error("URL did not return an RSS or Atom feed.");
    }

    const items = parseRssFeed(xml);
    const title = firstFeedTitle(xml);
    if (!title) {
      throw new Error("RSS validation could not read feed title.");
    }

    return {
      itemCount: items.length,
      title,
      url: response.url || feedUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseRssFeed(xml: string): NormalizedSourceItem[] {
  const entries = extractEntryXml(xml);

  return entries
    .map(parseEntry)
    .filter((item): item is NormalizedSourceItem => item !== null);
}

function extractEntryXml(xml: string): string[] {
  const itemMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(
    (match) => match[0],
  );

  if (itemMatches.length > 0) {
    return itemMatches;
  }

  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function parseEntry(entryXml: string): NormalizedSourceItem | null {
  const title = firstText(entryXml, "title");
  const url = firstLink(entryXml);

  if (!title || !url) {
    return null;
  }

  const summary =
    firstText(entryXml, "content:encoded") ??
    firstText(entryXml, "description") ??
    firstText(entryXml, "summary") ??
    firstText(entryXml, "content");
  const author = firstText(entryXml, "author") ?? firstText(entryXml, "dc:creator");
  const publishedText =
    firstText(entryXml, "pubDate") ??
    firstText(entryXml, "published") ??
    firstText(entryXml, "updated");
  const publishedAt = parseDate(publishedText);
  const canonicalUrl = canonicalizeItemUrl(url);

  return {
    title,
    url,
    canonicalUrl,
    summary,
    author,
    publishedAt,
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    rawMetadata: {
      publishedText,
    },
  };
}

function firstText(xml: string, tagName: string): string | undefined {
  const escapedTag = tagName.replace(":", "\\:");
  const match = xml.match(
    new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );
  return match?.[1] ? decodeXml(stripCdata(match[1]).trim()) : undefined;
}

function firstFeedTitle(xml: string): string | undefined {
  const withoutEntries = xml.replace(/<(item|entry)\b[\s\S]*?<\/\1>/gi, "");
  return firstText(withoutEntries, "title");
}

function firstLink(xml: string): string | undefined {
  const rssLink = firstText(xml, "link");
  if (rssLink) {
    return rssLink;
  }

  const alternateLink = xml.match(
    /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  if (alternateLink) {
    return decodeXml(alternateLink.trim());
  }

  const anyLink = xml.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
  return anyLink ? decodeXml(anyLink.trim()) : undefined;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function canonicalizeItemUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

function createContentHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
