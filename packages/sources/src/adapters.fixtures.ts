import { fetchArxivPapers, fetchGitHubReleases } from "./adapters.js";

export function runAdaptersFixtures(): Promise<void> {
  return Promise.all([
    assertArxivPaperFetch(),
    assertGitHubReleasesFetch(),
    assertArxivHttpError(),
  ]).then(() => undefined);
}

function assertArxivPaperFetch(): Promise<void> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Paper Title One</title>
    <link href="http://arxiv.org/abs/1234.5678v1" rel="alternate" type="text/html"/>
    <id>http://arxiv.org/abs/1234.5678v1</id>
    <summary>This is the abstract.</summary>
    <name>Author Name</name>
    <published>2024-01-15T00:00:00Z</published>
    <updated>2024-01-16T00:00:00Z</updated>
  </entry>
  <entry>
    <title>Paper Title Two</title>
    <link href="http://arxiv.org/abs/2345.6789v1" rel="alternate" type="text/html"/>
    <id>http://arxiv.org/abs/2345.6789v1</id>
    <summary>Second abstract.</summary>
    <published>2024-02-01T00:00:00Z</published>
    <updated>2024-02-02T00:00:00Z</updated>
  </entry>
</feed>`;

  return fetchArxivPapers("cat:cs.AI", {
    fetchImpl: async () =>
      new Response(xml, {
        headers: { "content-type": "application/atom+xml" },
        status: 200,
      }),
  }).then((items) => {
    assert(items.length === 2, "arXiv should parse two entries.");
    assert(items[0]?.title === "Paper Title One", "arXiv title should match.");
    assert(items[0]?.url === "http://arxiv.org/abs/1234.5678v1", "arXiv URL should match.");
    assert(items[0]?.author === "Author Name", "arXiv author should match.");
    assert(
      items[0]?.publishedAt?.toISOString() === "2024-01-15T00:00:00.000Z",
      "arXiv published date should match.",
    );
  });
}

function assertGitHubReleasesFetch(): Promise<void> {
  const payload = JSON.stringify([
    {
      body: "Release notes here",
      html_url: "https://github.com/org/repo/releases/tag/v1.0.0",
      id: 1,
      name: "Version 1.0.0",
      published_at: "2024-03-01T00:00:00Z",
      tag_name: "v1.0.0",
    },
  ]);

  return fetchGitHubReleases("org/repo", {
    fetchImpl: async () =>
      new Response(payload, {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
  }).then((items) => {
    assert(items.length === 1, "GitHub should parse one release.");
    assert(items[0]?.title === "Version 1.0.0", "GitHub title should match.");
    assert(
      items[0]?.url === "https://github.com/org/repo/releases/tag/v1.0.0",
      "GitHub URL should match.",
    );
    assert(items[0]?.author === "org/repo", "GitHub author should be repo name.");
    assert(
      items[0]?.publishedAt?.toISOString() === "2024-03-01T00:00:00.000Z",
      "GitHub published date should match.",
    );
  });
}

async function assertArxivHttpError(): Promise<void> {
  await assertRejects(
    () =>
      fetchArxivPapers("test", {
        fetchImpl: async () => new Response("Not found", { status: 404 }),
      }),
    "arXiv should throw on HTTP error.",
  );
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}
