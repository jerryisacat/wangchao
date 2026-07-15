export interface SearchResult {
  snippet?: string;
  title: string;
  url: string;
}

export interface SearchProvider {
  searchSources(query: string, options?: SearchSourcesOptions): Promise<SearchResult[]>;
}

export type SearchProviderType = "brave" | "tavily" | "serper" | "searxng";

export interface SearchSourcesOptions {
  count?: number;
  fetchImpl?: typeof fetch;
}

const SEARCH_MAX_BODY_BYTES = 2 * 1024 * 1024;

class Throttle {
  private lastRun = 0;
  private readonly minIntervalMs: number;

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const waitMs = Math.max(0, this.minIntervalMs - (now - this.lastRun));
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    this.lastRun = Date.now();
    return fn();
  }
}

const searchThrottle = new Throttle(2);

function withThrottle(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => searchThrottle.run(() => fetchImpl(input as string | URL, init));
}

function withBodyLimit(fetchImpl: typeof fetch, maxBodyBytes: number = SEARCH_MAX_BODY_BYTES): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input as string | URL, init);
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      throw new Error(`Response body exceeds max size (${contentLength} bytes)`);
    }
    return response;
  };
}

export interface BraveSearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface TavilySearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SerperSearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SearXngSearchProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface FeedCandidate {
  evidence: Record<string, unknown>;
  feedUrl: string;
  name: string;
  pageUrl: string;
}

export interface FeedProbeOptions {
  fetchImpl?: typeof fetch;
  maxCandidates?: number;
  timeoutMs?: number;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      description?: string;
      title?: string;
      url?: string;
    }>;
  };
}

const DEFAULT_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const FEED_CONTENT_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
];

export class BraveSearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BraveSearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BRAVE_SEARCH_URL;
    const baseFetch = options.fetchImpl ?? fetch;
    this.fetchImpl = withBodyLimit(withThrottle(baseFetch));
  }

  async searchSources(
    query: string,
    options: SearchSourcesOptions = {},
  ): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(options.count ?? 5));

    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as BraveSearchResponse;
    return (payload.web?.results ?? [])
      .map((result) => ({
        snippet: result.description,
        title: result.title ?? result.url ?? "Untitled result",
        url: result.url ?? "",
      }))
      .filter((result) => isHttpUrl(result.url));
  }
}

const DEFAULT_TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilySearchResponse {
  results?: Array<{
    content?: string;
    title?: string;
    url?: string;
  }>;
}

export class TavilySearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TavilySearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_TAVILY_SEARCH_URL;
    const baseFetch = options.fetchImpl ?? fetch;
    this.fetchImpl = withBodyLimit(withThrottle(baseFetch));
  }

  async searchSources(
    query: string,
    options: SearchSourcesOptions = {},
  ): Promise<SearchResult[]> {
    const response = await this.fetchImpl(this.baseUrl, {
      body: JSON.stringify({
        api_key: this.apiKey,
        max_results: options.count ?? 5,
        query,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as TavilySearchResponse;
    return (payload.results ?? [])
      .map((result) => ({
        snippet: result.content,
        title: result.title ?? result.url ?? "Untitled result",
        url: result.url ?? "",
      }))
      .filter((result) => isHttpUrl(result.url));
  }
}

const DEFAULT_SERPER_SEARCH_URL = "https://google.serper.dev/search";

interface SerperSearchResponse {
  organic?: Array<{
    link?: string;
    snippet?: string;
    title?: string;
  }>;
}

export class SerperSearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SerperSearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_SERPER_SEARCH_URL;
    const baseFetch = options.fetchImpl ?? fetch;
    this.fetchImpl = withBodyLimit(withThrottle(baseFetch));
  }

  async searchSources(
    query: string,
    options: SearchSourcesOptions = {},
  ): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("num", String(options.count ?? 5));

    const response = await this.fetchImpl(url, {
      body: JSON.stringify({ q: query }),
      headers: {
        "X-API-KEY": this.apiKey,
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Serper search failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as SerperSearchResponse;
    return (payload.organic ?? [])
      .map((result) => ({
        snippet: result.snippet,
        title: result.title ?? result.link ?? "Untitled result",
        url: result.link ?? "",
      }))
      .filter((result) => isHttpUrl(result.url));
  }
}

interface SearXngSearchResponse {
  results?: Array<{
    content?: string;
    title?: string;
    url?: string;
  }>;
}

export class SearXngSearchProvider implements SearchProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SearXngSearchProviderOptions) {
    this.baseUrl = options.baseUrl;
    const baseFetch = options.fetchImpl ?? fetch;
    this.fetchImpl = withBodyLimit(withThrottle(baseFetch));
  }

  async searchSources(
    query: string,
    options: SearchSourcesOptions = {},
  ): Promise<SearchResult[]> {
    const url = new URL(`${this.baseUrl.replace(/\/+$/, "")}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageno", "1");

    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as SearXngSearchResponse;
    return (payload.results ?? [])
      .map((result) => ({
        snippet: result.content,
        title: result.title ?? result.url ?? "Untitled result",
        url: result.url ?? "",
      }))
      .filter((result) => isHttpUrl(result.url))
      .slice(0, options.count ?? 5);
  }
}

export function createSearchProvider(
  type: SearchProviderType,
  config: { apiKey?: string; baseUrl?: string },
): SearchProvider | null {
  switch (type) {
    case "brave":
      return config.apiKey
        ? new BraveSearchProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl })
        : null;
    case "tavily":
      return config.apiKey
        ? new TavilySearchProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl })
        : null;
    case "serper":
      return config.apiKey
        ? new SerperSearchProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl })
        : null;
    case "searxng":
      return config.baseUrl
        ? new SearXngSearchProvider({ baseUrl: config.baseUrl })
        : null;
    default:
      return null;
  }
}

export async function discoverFeedCandidatesFromSearchResult(
  result: SearchResult,
  options: FeedProbeOptions = {},
): Promise<FeedCandidate[]> {
  const direct = await validateFeedUrl(result.url, options);
  if (direct) {
    return [
      {
        evidence: {
          searchResultTitle: result.title,
          searchResultUrl: result.url,
          snippet: result.snippet,
          source: "direct-feed-url",
        },
        feedUrl: direct.feedUrl,
        name: direct.title ?? result.title,
        pageUrl: result.url,
      },
    ];
  }

  return discoverFeedCandidatesFromPage(result.url, {
    ...options,
    searchResult: result,
  });
}

export async function discoverFeedCandidatesFromPage(
  pageUrl: string,
  options: FeedProbeOptions & { searchResult?: SearchResult } = {},
): Promise<FeedCandidate[]> {
  if (!isHttpUrl(pageUrl)) {
    return [];
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const page = await fetchText(pageUrl, {
    accept: "text/html, application/xhtml+xml",
    fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const candidates = uniqueStrings([
    ...extractAlternateFeedUrls(page.text, page.finalUrl),
    ...commonFeedUrls(page.finalUrl),
  ]).slice(0, options.maxCandidates ?? 8);
  const feeds: FeedCandidate[] = [];

  for (const candidateUrl of candidates) {
    const validated = await validateFeedUrl(candidateUrl, {
      fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    if (!validated) {
      continue;
    }

    feeds.push({
      evidence: {
        discoveredFrom: page.finalUrl,
        searchResultTitle: options.searchResult?.title,
        searchResultUrl: options.searchResult?.url,
        source: "page-feed-probe",
      },
      feedUrl: validated.feedUrl,
      name: validated.title ?? titleFromUrl(validated.feedUrl),
      pageUrl: page.finalUrl,
    });
  }

  return dedupeFeedCandidates(feeds);
}

export function extractExternalLinks(html: string, baseUrl: string): string[] {
  if (!isHttpUrl(baseUrl)) {
    return [];
  }

  const base = new URL(baseUrl);
  const urls = [
    ...html.matchAll(/\bhref=["']([^"']+)["']/gi),
    ...html.matchAll(/\bsrc=["']([^"']+)["']/gi),
  ]
    .map((match) => toHttpUrl(match[1], base.href))
    .filter((url): url is string => Boolean(url))
    .filter((url) => new URL(url).hostname !== base.hostname);

  return uniqueStrings(urls);
}

export async function extractExternalLinksFromPage(
  pageUrl: string,
  options: FeedProbeOptions = {},
): Promise<string[]> {
  const page = await fetchText(pageUrl, {
    accept: "text/html, application/xhtml+xml",
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs,
  });

  return extractExternalLinks(page.text, page.finalUrl);
}

export function buildTopicSearchQueries(input: {
  keywords: string[];
  topicName: string;
}): string[] {
  return uniqueStrings([
    `${input.topicName} RSS`,
    `${input.topicName} news feed`,
    ...input.keywords.map((keyword) => `${keyword} RSS`),
    ...input.keywords.map((keyword) => `${keyword} announcements`),
  ]).slice(0, 6);
}

export function extractTopicKeywords(profile: unknown): string[] {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return [];
  }

  const keywords = (profile as { keywords?: unknown }).keywords;
  if (!Array.isArray(keywords)) {
    return [];
  }

  return keywords
    .filter((keyword): keyword is string => typeof keyword === "string")
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function validateFeedUrl(
  url: string,
  options: FeedProbeOptions,
): Promise<{ feedUrl: string; title?: string } | null> {
  if (!isHttpUrl(url)) {
    return null;
  }

  try {
    const feed = await fetchText(url, {
      accept: FEED_CONTENT_TYPES.join(", "),
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs,
    });
    const contentType = feed.contentType.toLowerCase();
    const looksLikeFeed =
      FEED_CONTENT_TYPES.some((type) => contentType.includes(type)) ||
      /<(rss|feed)\b/i.test(feed.text);

    if (!looksLikeFeed) {
      return null;
    }

    return {
      feedUrl: feed.finalUrl,
      title: firstTagText(feed.text, "title") ?? titleFromUrl(feed.finalUrl),
    };
  } catch {
    return null;
  }
}

function extractAlternateFeedUrls(html: string, baseUrl: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => {
      const tag = match[0];
      return (
        /\brel=["'][^"']*alternate[^"']*["']/i.test(tag) &&
        /\btype=["'][^"']*(rss|atom|xml)[^"']*["']/i.test(tag)
      );
    })
    .map((match) => match[0].match(/\bhref=["']([^"']+)["']/i)?.[1])
    .map((href) => (href ? toHttpUrl(href, baseUrl) : null))
    .filter((url): url is string => Boolean(url));
}

function commonFeedUrls(pageUrl: string): string[] {
  const parsed = new URL(pageUrl);
  const origin = parsed.origin;

  return [
    "/feed",
    "/rss",
    "/rss.xml",
    "/feed.xml",
    "/atom.xml",
    "/index.xml",
  ].map((path) => `${origin}${path}`);
}

async function fetchText(
  url: string,
  options: {
    accept: string;
    fetchImpl: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ contentType: string; finalUrl: string; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await options.fetchImpl(url, {
      headers: {
        accept: options.accept,
        "user-agent": "WangchaoSourceDiscovery/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}`);
    }

    return {
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: response.url || url,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function firstTagText(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim();
}

function toHttpUrl(value: string | undefined, baseUrl: string): string | null {
  if (!value || value.startsWith("mailto:") || value.startsWith("javascript:")) {
    return null;
  }

  try {
    const parsed = new URL(value, baseUrl);
    parsed.hash = "";
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function dedupeFeedCandidates(candidates: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  const unique: FeedCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.feedUrl.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "");
}
