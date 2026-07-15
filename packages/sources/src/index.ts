import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { XMLParser } from "fast-xml-parser";

export type SourceKind = "rss" | "web";

export {
  fetchArxivPapers,
  fetchGitHubReleases,
  AdapterError,
  type ArxivFetchOptions,
  type GitHubReleasesFetchOptions,
} from "./adapters.js";

export {
  BraveSearchProvider,
  SearXngSearchProvider,
  SerperSearchProvider,
  TavilySearchProvider,
  buildTopicSearchQueries,
  createSearchProvider,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinks,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  type FeedCandidate,
  type FeedProbeOptions,
  type SearchProvider,
  type SearchProviderType,
  type SearchResult,
  type SearchSourcesOptions,
  type SearXngSearchProviderOptions,
  type SerperSearchProviderOptions,
  type TavilySearchProviderOptions,
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
  rawContent?: string;
  rawMetadata: Record<string, unknown>;
}

export interface FetchRssFeedOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
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

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
function decodeNumericEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  tagValueProcessor: (_name, value) => (typeof value === "string" ? decodeNumericEntities(value) : value),
  isArray: (name) => ["item", "entry"].includes(name),
});

export async function fetchRssFeed(
  feedUrl: string,
  options: FetchRssFeedOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
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

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      throw new FetchRssError(`RSS body exceeds max size (${contentLength} bytes)`, 413);
    }

    try {
      const raw = await response.text();
      return parseRssFeed(stripBom(raw));
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
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
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

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      throw new Error(`RSS validation body exceeds max size (${contentLength} bytes)`);
    }

    const raw = await response.text();
    const xml = stripBom(raw);
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
  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return [];
  }

  const rss = parsed.rss as Record<string, unknown> | undefined;
  const feed = parsed.feed as Record<string, unknown> | undefined;

  if (rss) {
    const channel = rss.channel as Record<string, unknown> | undefined;
    if (!channel) return [];
    const items = channel.item;
    if (!items) return [];
    return (Array.isArray(items) ? items : [items])
      .map((item) => parseRssItem(item as Record<string, unknown>))
      .filter((item): item is NormalizedSourceItem => item !== null);
  }

  if (feed) {
    const entries = feed.entry;
    if (!entries) return [];
    return (Array.isArray(entries) ? entries : [entries])
      .map((entry) => parseAtomEntry(entry as Record<string, unknown>))
      .filter((item): item is NormalizedSourceItem => item !== null);
  }

  return [];
}

export interface FetchArticleOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxContentLength?: number;
}

export async function fetchArticleContent(
  articleUrl: string,
  options: FetchArticleOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxContentLength = options.maxContentLength ?? 100_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(articleUrl, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "user-agent": "WangchaoWorker/1.0 Article fetcher",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxContentLength) {
      return null;
    }

    const html = await response.text();
    if (html.length > maxContentLength) {
      return null;
    }

    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article?.textContent) {
      return null;
    }

    return article.textContent.replace(/\s+/g, " ").trim().slice(0, 20_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItem(item: Record<string, unknown>): NormalizedSourceItem | null {
  const title = textOf(item.title);
  const link = textOf(item.link) ?? rssLinkHref(item.link);
  if (!title || !link) return null;

  const encodedContent = textOf(item["content:encoded"]);
  const summary =
    encodedContent ??
    textOf(item.description) ??
    textOf(item.summary) ??
    textOf(item.content);
  const author = textOf(item.author) ?? textOf(item["dc:creator"]);
  const published =
    textOf(item.pubDate) ??
    textOf(item.published) ??
    textOf(item.updated);
  const canonicalUrl = canonicalizeItemUrl(link);

  return {
    title,
    url: link,
    canonicalUrl,
    summary,
    author,
    publishedAt: parseDate(published),
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    rawContent: encodedContent ? stripHtml(encodedContent).slice(0, 20_000) : undefined,
    rawMetadata: { publishedText: published ?? null },
  };
}

function parseAtomEntry(entry: Record<string, unknown>): NormalizedSourceItem | null {
  const title = textOf(entry.title);
  const link = atomLink(entry.link);
  if (!title || !link) return null;

  const encodedContent = textOf(entry["content:encoded"]);
  const summary =
    encodedContent ??
    textOf(entry.summary) ??
    textOf(entry.content);
  const author = atomAuthor(entry.author);
  const published =
    textOf(entry.published) ??
    textOf(entry.updated);
  const canonicalUrl = canonicalizeItemUrl(link);

  return {
    title,
    url: link,
    canonicalUrl,
    summary,
    author,
    publishedAt: parseDate(published),
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    rawContent: encodedContent ? stripHtml(encodedContent).slice(0, 20_000) : undefined,
    rawMetadata: { publishedText: published ?? null },
  };
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value && "#text" in value) {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return undefined;
}

function rssLinkHref(value: unknown): string | undefined {
  if (typeof value === "object" && value && "@_href" in value) {
    const href = (value as Record<string, unknown>)["@_href"];
    return typeof href === "string" ? href : undefined;
  }
  return undefined;
}

function atomLink(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const entries = Array.isArray(value) ? value : [value];
  for (const link of entries) {
    if (typeof link === "object" && link && "@_rel" in link) {
      const rel = (link as Record<string, unknown>)["@_rel"];
      if (rel === "alternate" || rel === undefined) {
        const href = (link as Record<string, unknown>)["@_href"];
        if (typeof href === "string") return href;
      }
    }
  }
  const first = entries[0];
  if (typeof first === "object" && first && "@_href" in first) {
    const href = (first as Record<string, unknown>)["@_href"];
    return typeof href === "string" ? href : undefined;
  }
  return undefined;
}

function atomAuthor(author: unknown): string | undefined {
  if (!author) return undefined;
  if (typeof author === "string") return author;
  if (Array.isArray(author)) {
    author = author[0];
  }
  if (typeof author === "object" && author && "name" in author) {
    const name = (author as Record<string, unknown>).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function firstFeedTitle(xml: string): string | undefined {
  const parsed = xmlParser.parse(xml);
  const rss = parsed.rss as Record<string, unknown> | undefined;
  if (rss) {
    const channel = rss.channel as Record<string, unknown> | undefined;
    if (channel?.title) return textOf(channel.title);
  }
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (feed?.title) return textOf(feed.title);
  return undefined;
}

function stripBom(value: string): string {
  return value.replace(/^﻿/, "");
}

export { stripBom };

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
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

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
