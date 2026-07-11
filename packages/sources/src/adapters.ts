import type { NormalizedSourceItem } from "./index.js";

export interface ArxivFetchOptions {
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
}

const ARXIV_API_URL = "http://export.arxiv.org/api/query";
const ARXIV_NAMESPACE = "http://www.w3.org/2005/Atom";

export async function fetchArxivPapers(
  searchQuery: string,
  options: ArxivFetchOptions = {},
): Promise<NormalizedSourceItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 15_000;
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
      throw new Error(`arXiv API failed with HTTP ${response.status}`);
    }

    return parseArxivFeed(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

function parseArxivFeed(xml: string): NormalizedSourceItem[] {
  const entries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);

  return entries
    .map(parseArxivEntry)
    .filter((item): item is NormalizedSourceItem => item !== null);
}

function parseArxivEntry(entryXml: string): NormalizedSourceItem | null {
  const title = firstAtomText(entryXml, "title");
  const url = firstArxivLink(entryXml);

  if (!title || !url) return null;

  const summary = firstAtomText(entryXml, "summary");
  const author = firstAtomText(entryXml, "name");
  const publishedText = firstAtomText(entryXml, "published");
  const updatedText = firstAtomText(entryXml, "updated");
  const publishedAt = parseDate(publishedText ?? updatedText);
  const canonicalUrl = canonicalizeItemUrl(url);

  return {
    title: title.replace(/\s+/g, " ").trim(),
    url,
    canonicalUrl,
    summary: summary?.replace(/\s+/g, " ").trim(),
    author,
    publishedAt,
    contentHash: createContentHash(`${title}\n${canonicalUrl}`),
    rawContent: summary?.replace(/\s+/g, " ").trim().slice(0, 20_000),
    rawMetadata: {
      publishedText,
      source: "arxiv",
      updatedText,
    },
  };
}

function firstAtomText(xml: string, tagName: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  return match?.[1] ? decodeXml(stripCdata(match[1]).trim()) : undefined;
}

function firstArxivLink(xml: string): string | undefined {
  const alternate = xml.match(
    /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  if (alternate) return decodeXml(alternate.trim());

  const anyLink = xml.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
  return anyLink ? decodeXml(anyLink.trim()) : undefined;
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
    const url = `${GITHUB_API_URL}/repos/${repo}/releases?per_page=${maxResults}`;
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
      throw new Error(`GitHub API failed with HTTP ${response.status}`);
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
        const url = release.html_url ?? "";
        const title = release.name ?? release.tag_name ?? "";
        if (!title || !url) return null;

        const canonicalUrl = canonicalizeItemUrl(url);
        const summary = release.body?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const publishedAt = parseDate(release.published_at);

        return {
          title,
          url,
          canonicalUrl,
          summary,
          author: repo,
          publishedAt,
          contentHash: createContentHash(`${title}\n${canonicalUrl}`),
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

function createContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export { ARXIV_NAMESPACE };
