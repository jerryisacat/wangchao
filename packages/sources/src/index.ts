import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { XMLParser } from "fast-xml-parser";
import { canonicalizeUrl } from "@wangchao/db";
import { createContentHash, isHttpUrl } from "@wangchao/core";
import { assertSafeUrl } from "./ssrf.js";

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
  contentSource?: "RSS_EMBEDDED";
  contentStatus?: "READY" | "INSUFFICIENT";
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  tagValueProcessor: (_name, value) =>
    typeof value === "string" ? decodeNumericEntities(value) : value,
  isArray: (name: string) => ["item", "entry"].includes(name),
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
    await assertSafeUrl(feedUrl);
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
  await assertSafeUrl(feedUrl);

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

export interface ArticleMarkdownResult {
  contentSource: "ARTICLE_HTML";
  errorCode?: string;
  markdown?: string;
  status: "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
}

const MIN_ARTICLE_MARKDOWN_LENGTH = 80;
const MAX_STORED_MARKDOWN_LENGTH = 20_000;

export async function fetchArticleMarkdown(
  articleUrl: string,
  options: FetchArticleOptions = {},
): Promise<ArticleMarkdownResult> {
  if (isUnsupportedPlatformUrl(articleUrl)) {
    return {
      contentSource: "ARTICLE_HTML",
      errorCode: "PLATFORM_NOT_SUPPORTED",
      status: "UNSUPPORTED",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxContentLength = options.maxContentLength ?? 100_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await assertSafeUrl(articleUrl);
    const response = await fetchImpl(articleUrl, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "user-agent": "WangchaoWorker/1.0 Article fetcher",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        contentSource: "ARTICLE_HTML",
        errorCode: `HTTP_${response.status}`,
        status: "FETCH_FAILED",
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxContentLength) {
      return {
        contentSource: "ARTICLE_HTML",
        errorCode: "CONTENT_TOO_LARGE",
        status: "FETCH_FAILED",
      };
    }

    const html = await response.text();
    if (html.length > maxContentLength) {
      return {
        contentSource: "ARTICLE_HTML",
        errorCode: "CONTENT_TOO_LARGE",
        status: "FETCH_FAILED",
      };
    }

    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article?.content) {
      return {
        contentSource: "ARTICLE_HTML",
        errorCode: "READABILITY_EMPTY",
        status: "INSUFFICIENT",
      };
    }

    const markdown = htmlToSafeMarkdown(article.content, articleUrl);
    if (markdown.length < MIN_ARTICLE_MARKDOWN_LENGTH) {
      return {
        contentSource: "ARTICLE_HTML",
        errorCode: "CONTENT_TOO_SHORT",
        markdown: markdown || undefined,
        status: "INSUFFICIENT",
      };
    }

    return {
      contentSource: "ARTICLE_HTML",
      markdown: markdown.slice(0, MAX_STORED_MARKDOWN_LENGTH),
      status: "READY",
    };
  } catch {
    return {
      contentSource: "ARTICLE_HTML",
      errorCode: "FETCH_ERROR",
      status: "FETCH_FAILED",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Converts untrusted HTML into a deliberately small Markdown subset. The DOM is
 * never executed; active/embed elements are dropped and only safe HTTP(S)
 * links are retained.
 */
export function htmlToSafeMarkdown(html: string, baseUrl?: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const root = document.body;
  const markdown = Array.from(root.childNodes)
    .map((node) => renderMarkdownNode(node, { baseUrl, listDepth: 0 }))
    .join("");

  return normalizeMarkdown(markdown).slice(0, MAX_STORED_MARKDOWN_LENGTH);
}

interface MarkdownRenderContext {
  baseUrl?: string;
  listDepth: number;
}

const DROPPED_HTML_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "CANVAS",
  "FORM",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "META",
  "LINK",
]);

function renderMarkdownNode(node: Node, context: MarkdownRenderContext): string {
  if (node.nodeType === 3) {
    return escapeMarkdownText(node.textContent ?? "");
  }
  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (DROPPED_HTML_TAGS.has(tag)) return "";

  const children = () =>
    Array.from(element.childNodes)
      .map((child) => renderMarkdownNode(child, context))
      .join("");

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `\n\n${"#".repeat(level)} ${children().trim()}\n\n`;
  }
  if (["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE"].includes(tag)) {
    return `\n\n${children().trim()}\n\n`;
  }
  if (tag === "BR") return "\n";
  if (["STRONG", "B"].includes(tag)) return `**${children().trim()}**`;
  if (["EM", "I"].includes(tag)) return `*${children().trim()}*`;
  if (["DEL", "S", "STRIKE"].includes(tag)) return `~~${children().trim()}~~`;
  if (tag === "CODE" && element.parentElement?.tagName.toUpperCase() !== "PRE") {
    return `\`${children().trim().replaceAll("`", "\\`")}\``;
  }
  if (tag === "PRE") {
    const code = (element.textContent ?? "").replaceAll("```", "` ` `").trim();
    return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : "";
  }
  if (tag === "BLOCKQUOTE") {
    const body = children().trim().split("\n").map((line) => `> ${line}`).join("\n");
    return body ? `\n\n${body}\n\n` : "";
  }
  if (tag === "A") {
    const label = children().trim();
    const href = safeMarkdownUrl(element.getAttribute("href"), context.baseUrl);
    return href && label ? `[${label}](${href})` : label;
  }
  if (tag === "UL" || tag === "OL") {
    const nextContext = { ...context, listDepth: context.listDepth + 1 };
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toUpperCase() === "LI")
      .map((child, index) => {
        const marker = tag === "OL" ? `${index + 1}.` : "-";
        const body = Array.from(child.childNodes)
          .map((itemNode) => renderMarkdownNode(itemNode, nextContext))
          .join("")
          .trim();
        return `${"  ".repeat(context.listDepth)}${marker} ${body}`;
      })
      .join("\n");
    return items ? `\n${items}\n` : "";
  }
  if (tag === "LI") return children();

  return children();
}

function safeMarkdownUrl(value: string | null, baseUrl?: string): string | null {
  if (!value) return null;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]()])/g, "\\$1")
    .replace(/javascript\s*:/gi, "javascript&#58;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\s+/g, " ");
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isUnsupportedPlatformUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com");
  } catch {
    return false;
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
  const canonicalUrl = canonicalizeUrl(link);
  const embeddedMarkdown = encodedContent
    ? htmlToSafeMarkdown(encodedContent, link)
    : undefined;

  return {
    title,
    url: link,
    canonicalUrl,
    summary,
    author,
    publishedAt: parseDate(published),
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    rawContent: embeddedMarkdown || undefined,
    contentSource: encodedContent ? "RSS_EMBEDDED" : undefined,
    contentStatus: encodedContent ? (embeddedMarkdown ? "READY" : "INSUFFICIENT") : undefined,
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
  const canonicalUrl = canonicalizeUrl(link);
  const embeddedMarkdown = encodedContent
    ? htmlToSafeMarkdown(encodedContent, link)
    : undefined;

  return {
    title,
    url: link,
    canonicalUrl,
    summary,
    author,
    publishedAt: parseDate(published),
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    rawContent: embeddedMarkdown || undefined,
    contentSource: encodedContent ? "RSS_EMBEDDED" : undefined,
    contentStatus: encodedContent ? (embeddedMarkdown ? "READY" : "INSUFFICIENT") : undefined,
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
