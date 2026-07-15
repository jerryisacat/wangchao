import {
  parseRssFeed,
  stripBom,
  type NormalizedSourceItem,
} from "./index.js";
import { createContentHash, stripHtml } from "@wangchao/core";

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface ArxivFetchOptions {
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function fetchArxivPapers(
  searchQuery: string,
  options: ArxivFetchOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(ARXIV_API_URL);
    url.searchParams.set("search_query", searchQuery);
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", String(maxResults));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");

    const response = await fetchImpl(url, {
      headers: { accept: "application/atom+xml, application/xml" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AdapterError(`arXiv API failed with HTTP ${response.status}`, "arxiv", response.status);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      throw new AdapterError(`arXiv body exceeds max size (${contentLength} bytes)`, "arxiv", 413);
    }

    const raw = await response.text();
    const items = parseRssFeed(stripBom(raw));
    return items.map((item) => ({
      ...item,
      rawMetadata: { ...item.rawMetadata, source: "arxiv" },
    }));
  } finally {
    clearTimeout(timeout);
  }
}

export interface GitHubReleasesFetchOptions {
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
  token?: string;
}

const GITHUB_API_URL = "https://api.github.com";

export async function fetchGitHubReleases(
  repo: string,
  options: GitHubReleasesFetchOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${GITHUB_API_URL}/repos/${encodeURIComponent(repo)}/releases?per_page=${maxResults}`;
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "WangchaoSourceDiscovery/1.0",
    };
    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }

    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AdapterError(`GitHub API failed with HTTP ${response.status}`, "github", response.status);
    }

    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (rateLimitRemaining && Number.parseInt(rateLimitRemaining, 10) === 0) {
      throw new AdapterError("GitHub API rate limit exceeded", "github", 403);
    }

    const releases = (await response.json()) as Array<{
      body?: string;
      html_url?: string;
      id?: number;
      name?: string;
      published_at?: string;
      tag_name?: string;
    }>;

    return releases
      .map((release): NormalizedSourceItem | null => {
        const itemUrl = release.html_url ?? "";
        const title = release.name ?? release.tag_name ?? "";
        if (!title || !itemUrl) return null;

        const parsed = new URL(itemUrl);
        parsed.hash = "";
        const canonicalUrl = parsed.toString();
        const summary = release.body ? stripHtml(release.body) : undefined;
        const timestamp = Date.parse(release.published_at ?? "");
        const publishedAt = Number.isNaN(timestamp) ? undefined : new Date(timestamp);

        return {
          title,
          url: itemUrl,
          canonicalUrl,
          summary,
          author: repo,
          publishedAt,
          contentHash: createContentHash(`${title}\n${canonicalUrl}\n${summary ?? ""}`),
          rawContent: summary?.slice(0, 20_000),
          rawMetadata: {
            repo,
            source: "github-releases",
            tag: release.tag_name,
          },
        };
      })
      .filter((item): item is NormalizedSourceItem => item !== null);
  } finally {
    clearTimeout(timeout);
  }
}

export {};
