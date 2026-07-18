import { parseHTML } from "linkedom";
import { canonicalizeUrl } from "@wangchao/db";
import { createContentHash } from "@wangchao/core";
import {
  fetchRssFeed,
  isFetchRssRetryable,
  type FetchRssFeedOptions,
  type NormalizedSourceItem,
} from "./index.js";
import { assertSafeUrl } from "./ssrf.js";

/**
 * Issue #168: unified source-adapter contract.
 *
 * A SourceAdapter takes a fetch-scheduling record (URL + kind + optional
 * metadata) and returns canonical {@link NormalizedSourceItem}s that feed
 * `upsertFetchedItems`. The contract is intentionally minimal so RSS, WEB
 * (public page / announcement list) and future specialized adapters
 * (arXiv, GitHub releases, ...) share one dispatch entry.
 *
 * `source.kind` (Prisma enum `RSS` | `WEB`) selects the adapter; adapters must
 * not reach outside their declared kind. Retries, TaskRun and rate-limit
 * accounting live in the worker (`fetch.ts`), not here.
 */
export interface SourceAdapter {
  readonly kind: "RSS" | "WEB";
  fetch(source: AdapterSourceInput, options?: FetchSourceOptions): Promise<NormalizedSourceItem[]>;
}

/**
 * Minimal fetch input. `kind` is required so the registry can dispatch before
 * reading the rest of the record; `url` is the only required network field.
 * `rawMetadata` carries adapter-specific hints (e.g. WEB list-page selector
 * config) and is treated as untrusted.
 */
export interface AdapterSourceInput {
  id: string;
  kind: "RSS" | "WEB";
  name: string;
  url: string;
  rawMetadata?: Record<string, unknown>;
}

export interface FetchSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/**
 * Typed WEB-adapter error. Mirrors {@link FetchRssError} semantics so the
 * worker's retry classifier (`isFetchRetryable`) can treat them uniformly.
 * `status` is the HTTP status when the error originated from a response,
 * `undefined` for parse/SSRF/transport failures.
 */
export class FetchWebError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FetchWebError";
  }
}

/**
 * Retryable predicate shared by the worker. Returns true for transient HTTP
 * statuses (408/429/5xx), AbortError (timeout) and TypeError (DNS/transport).
 * Mirrors {@link isFetchRssRetryable} so the same retry policy applies to WEB
 * and RSS sources.
 */
export function isFetchWebRetryable(error: unknown): boolean {
  if (error instanceof FetchWebError) {
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

/**
 * Unified retryable predicate: accepts FetchRssError, FetchWebError, and the
 * transport-level fallbacks. Use this in the worker when dispatching by source
 * kind so RSS and WEB share one retry policy.
 */
export function isFetchRetryable(error: unknown): boolean {
  return isFetchRssRetryable(error) || isFetchWebRetryable(error);
}

const DEFAULT_WEB_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS_PER_WEB_PAGE = 100;

/** RSS adapter: thin wrapper over the existing {@link fetchRssFeed}. */
export const rssAdapter: SourceAdapter = {
  kind: "RSS",
  async fetch(source, options) {
    return fetchRssFeed(source.url, options ?? {});
  },
};

/**
 * WEB adapter (Issue #168): fetches a public HTML page (announcement list /
 * change-detected page), extracts announcement links via configurable
 * selectors, and normalizes each link into a {@link NormalizedSourceItem}.
 *
 * The adapter reuses the same SSRF, body-size, timeout and redirect guards as
 * RSS fetch by going through {@link assertSafeUrl} and an explicit HTTP fetch
 * with AbortController + content-length check. It does NOT execute scripts;
 * linkedom parses the HTML into a static DOM and only safe HTTP(S) links are
 * retained. Each announcement link becomes one NormalizedSourceItem whose
 * `canonicalUrl` is stable so re-fetching the same page is idempotent -
 * `upsertFetchedItems` dedupes by `(topicId, canonicalUrl)`.
 *
 * Selector configuration lives in `source.rawMetadata.webAdapter`:
 *  - `itemSelector` (required): CSS selector for repeated announcement rows.
 *  - `linkSelector` (optional): CSS selector within an item for the anchor;
 *    defaults to the first `<a href>` in the item.
 *  - `titleSelector` (optional): CSS selector within an item for the title
 *    text; defaults to the anchor text.
 *  - `dateSelector` / `dateAttr` (optional): selector / attribute for the
 *    publish date; parsed leniently.
 *
 * If no `itemSelector` is configured, the adapter falls back to scanning all
 * `<a href>` anchors on the page whose text is non-empty (generic change
 * detection mode). This is intentionally permissive - sources without
 * explicit selectors still produce items, but the operator is expected to
 * configure selectors for production use.
 */
export const webAdapter: SourceAdapter = {
  kind: "WEB",
  async fetch(source, options = {}) {
    return fetchWebListPage(source.url, source.rawMetadata, options);
  },
};

const REGISTRY: ReadonlyMap<"RSS" | "WEB", SourceAdapter> = new Map([
  ["RSS", rssAdapter],
  ["WEB", webAdapter],
]);

/**
 * Dispatch entry used by the worker. Looks up the adapter by `source.kind`
 * and throws a typed {@link UnknownSourceKindError} if no adapter is
 * registered. Unknown kinds are non-retryable.
 */
export function getAdapter(kind: "RSS" | "WEB"): SourceAdapter {
  const adapter = REGISTRY.get(kind);
  if (!adapter) {
    throw new UnknownSourceKindError(`No adapter registered for SourceKind ${kind}`, kind);
  }
  return adapter;
}

export async function fetchSource(
  source: AdapterSourceInput,
  options?: FetchSourceOptions,
): Promise<NormalizedSourceItem[]> {
  return getAdapter(source.kind).fetch(source, options);
}

export class UnknownSourceKindError extends Error {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message);
    this.name = "UnknownSourceKindError";
  }
}

interface WebAdapterConfig {
  itemSelector?: string;
  linkSelector?: string;
  titleSelector?: string;
  dateSelector?: string;
  dateAttr?: string;
  summarySelector?: string;
}

function readWebConfig(raw: Record<string, unknown> | undefined): WebAdapterConfig {
  const config = raw?.webAdapter;
  if (!config || typeof config !== "object") return {};
  const cfg = config as Record<string, unknown>;
  return {
    itemSelector: typeof cfg.itemSelector === "string" ? cfg.itemSelector : undefined,
    linkSelector: typeof cfg.linkSelector === "string" ? cfg.linkSelector : undefined,
    titleSelector: typeof cfg.titleSelector === "string" ? cfg.titleSelector : undefined,
    dateSelector: typeof cfg.dateSelector === "string" ? cfg.dateSelector : undefined,
    dateAttr: typeof cfg.dateAttr === "string" ? cfg.dateAttr : undefined,
    summarySelector: typeof cfg.summarySelector === "string" ? cfg.summarySelector : undefined,
  };
}

export async function fetchWebListPage(
  url: string,
  rawMetadata: Record<string, unknown> | undefined,
  options: FetchSourceOptions & FetchRssFeedOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await assertSafeUrl(url);
    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "user-agent": "WangchaoWorker/1.0 WEB list-page fetcher",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new FetchWebError(`WEB fetch failed with HTTP ${response.status}`, response.status);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      throw new FetchWebError(`WEB body exceeds max size (${contentLength} bytes)`, 413);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const declaredCharset = readCharsetFromContentType(contentType);

    let raw = await response.text();
    if (raw.length > maxBodyBytes) {
      throw new FetchWebError(`WEB body exceeds max size after read (${raw.length} bytes)`, 413);
    }

    // The HTTP stack usually decodes correctly, but for pages served as latin-1
    // with a <meta charset> mismatch we re-decode from bytes when the page
    // declares a charset that differs from the Response default. This mirrors
    // the RSS path's tolerance of mis-declared feeds without inventing a new
    // policy.
    const metaCharset = readCharsetFromHtml(raw) ?? declaredCharset;
    if (metaCharset && declaredCharset && metaCharset.toLowerCase() !== declaredCharset.toLowerCase()) {
      try {
        const buffer = new TextEncoder().encode(raw);
        raw = new TextDecoder(metaCharset).decode(buffer);
      } catch {
        // ignore decode failure, keep original
      }
    }

    return parseWebListPage(raw, url, readWebConfig(rawMetadata));
  } catch (error) {
    if (error instanceof FetchWebError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof TypeError) throw error;
    throw new FetchWebError(
      error instanceof Error ? error.message : "WEB list-page fetch failed",
      undefined,
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readCharsetFromContentType(contentType: string): string | undefined {
  const match = contentType.match(/charset=([^;]+)/i);
  return match && match[1] ? match[1].trim() : undefined;
}

function readCharsetFromHtml(html: string): string | undefined {
  // <meta charset="utf-8"> or <meta http-equiv="Content-Type" content="...; charset=...">
  const metaCharset = html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i);
  return metaCharset ? metaCharset[1] : undefined;
}

/**
 * Pure HTML parser used by both the fetcher and tests. Exposed so fixtures can
 * feed canned HTML and assert normalization without network access.
 */
export function parseWebListPage(
  html: string,
  baseUrl: string,
  config: WebAdapterConfig,
): NormalizedSourceItem[] {
  const { document } = parseHTML(html);
  const items: NormalizedSourceItem[] = [];
  const seen = new Set<string>();

  const rows = config.itemSelector
    ? Array.from(document.querySelectorAll(config.itemSelector))
    : Array.from(document.querySelectorAll("a[href]"));

  for (const row of rows.slice(0, MAX_ITEMS_PER_WEB_PAGE)) {
    const item = normalizeRow(row, config, baseUrl);
    if (!item) continue;
    if (seen.has(item.canonicalUrl)) continue;
    seen.add(item.canonicalUrl);
    items.push(item);
  }

  return items;
}

function normalizeRow(
  row: Element,
  config: WebAdapterConfig,
  baseUrl: string,
): NormalizedSourceItem | null {
  let anchor: HTMLAnchorElement | null = null;

  if (config.itemSelector) {
    anchor = (config.linkSelector
      ? row.querySelector(config.linkSelector)
      : row.querySelector("a[href]")) as HTMLAnchorElement | null;
  } else {
    anchor = row as HTMLAnchorElement;
  }

  if (!anchor || !anchor.getAttribute) return null;
  const href = anchor.getAttribute("href");
  if (!href) return null;

  const absoluteUrl = resolveUrl(href, baseUrl);
  if (!absoluteUrl) return null;

  const title =
    (config.titleSelector
      ? (row.querySelector(config.titleSelector)?.textContent ?? "").trim()
      : "") || (anchor.textContent ?? "").trim();

  if (!title) return null;
  if (!isHttpUrlSafe(absoluteUrl)) return null;

  const canonicalUrl = canonicalizeUrl(absoluteUrl);

  const summary = config.summarySelector
    ? (row.querySelector(config.summarySelector)?.textContent ?? "").trim() || undefined
    : undefined;

  const dateText = readDateText(row, config);
  const publishedAt = parseDate(dateText);

  return {
    title: title.slice(0, 500),
    url: absoluteUrl,
    canonicalUrl,
    summary: summary?.slice(0, 2_000) || undefined,
    publishedAt,
    contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
    // WEB list-page items carry no content yet - they await the article-fetch
    // sub-cycle. Leave contentStatus / contentSource undefined so the DB
    // defaults (PENDING / null) take effect; the article-markdown cycle will
    // populate ARTICLE_HTML content once the linked page is fetched.
    rawMetadata: {
      source: "web-list-page",
      dateText: dateText ?? null,
    },
  };
}

function readDateText(row: Element, config: WebAdapterConfig): string | undefined {
  if (!config.dateSelector) return undefined;
  const node = row.querySelector(config.dateSelector);
  if (!node) return undefined;
  if (config.dateAttr) {
    const attrValue = node.getAttribute(config.dateAttr);
    if (typeof attrValue === "string" && attrValue.trim()) return attrValue.trim();
  }
  const text = (node.textContent ?? "").trim();
  return text || undefined;
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    return url.toString();
  } catch {
    return null;
  }
}

function isHttpUrlSafe(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

export {};
