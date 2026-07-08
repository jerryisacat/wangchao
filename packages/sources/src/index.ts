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
      throw new Error(`RSS fetch failed with HTTP ${response.status}`);
    }

    return parseRssFeed(await response.text());
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

function firstLink(xml: string): string | undefined {
  const rssLink = firstText(xml, "link");
  if (rssLink) {
    return rssLink;
  }

  const atomHref = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return atomHref ? decodeXml(atomHref.trim()) : undefined;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXml(value: string): string {
  return value
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
