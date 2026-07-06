import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: readRequiredEnv("DATABASE_URL"),
  }),
});

interface SeedSource {
  name: string;
  url: string;
}

interface SeedTopic {
  name: string;
  description?: string;
  keywords?: string[];
  sources: SeedSource[];
}

interface SeedList {
  version: number;
  topics: SeedTopic[];
}

const DEFAULT_SEED_SOURCES_URL =
  "https://raw.githubusercontent.com/jerryisacat/wangchao/main/packages/db/seed-sources.json";
const FETCH_TIMEOUT_MS = 5000;

async function main() {
  const organizationSlug =
    process.env.WANGCHAO_DEFAULT_ORGANIZATION_SLUG ?? "default";
  const organizationName =
    process.env.WANGCHAO_DEFAULT_ORGANIZATION_NAME ?? "个人工作区";
  const ownerEmail =
    process.env.WANGCHAO_DEFAULT_USER_EMAIL ?? "owner@wangchao.local";
  const ownerName = process.env.WANGCHAO_DEFAULT_USER_NAME ?? "个人用户";

  const organization = await prisma.organization.upsert({
    where: { slug: organizationSlug },
    update: {},
    create: {
      name: organizationName,
      slug: organizationSlug,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: ownerName,
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  await prisma.source.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { name: "Wangchao Fixture RSS" },
        { url: { startsWith: "fixture://wangchao/" } },
        { canonicalUrl: { startsWith: "fixture://wangchao/" } },
      ],
    },
  });

  const seedList = await resolveSeedList();

  for (const topic of seedList.topics) {
    const existingTopic = await prisma.topic.findUnique({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: topic.name,
        },
      },
    });

    let topicId: string;

    if (existingTopic) {
      topicId = existingTopic.id;
    } else {
      const created = await prisma.topic.create({
        data: {
          organizationId: organization.id,
          ownerUserId: user.id,
          name: topic.name,
          description: topic.description,
          profile: { keywords: topic.keywords ?? [] },
          status: "ACTIVE",
        },
      });
      topicId = created.id;
    }

    for (const source of topic.sources) {
      const canonicalUrl = canonicalizeSeedUrl(source.url);
      const existingSource = await prisma.source.findUnique({
        where: {
          topicId_canonicalUrl: {
            topicId,
            canonicalUrl,
          },
        },
      });

      if (existingSource) {
        continue;
      }

      await prisma.source.create({
        data: {
          organizationId: organization.id,
          topicId,
          kind: "RSS",
          status: "ACTIVE",
          name: source.name,
          url: source.url,
          canonicalUrl,
          description: "由 seed 列表创建的默认 RSS 信源。",
        },
      });
    }
  }
}

async function resolveSeedList(): Promise<SeedList> {
  const legacyName = process.env.WANGCHAO_SEED_SOURCE_NAME;
  const legacyUrl = process.env.WANGCHAO_SEED_SOURCE_URL;

  if (legacyName && legacyUrl) {
    return buildLegacySeedList(legacyName, legacyUrl);
  }

  const url = process.env.WANGCHAO_SEED_SOURCES_URL ?? DEFAULT_SEED_SOURCES_URL;

  try {
    const list = await fetchSeedList(url);
    if (list) {
      return list;
    }
  } catch (error) {
    console.warn(
      `[seed] Fetching ${url} failed, falling back to committed file. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return readCommittedSeedList();
}

function buildLegacySeedList(name: string, url: string): SeedList {
  return {
    version: 1,
    topics: [
      {
        name: "AI 基础设施",
        description: "关注 AI 基础设施、模型供应商、Agent 平台和部署生态。",
        keywords: ["AI", "infrastructure", "agents", "模型", "算力"],
        sources: [{ name, url }],
      },
    ],
  };
}

async function fetchSeedList(url: string): Promise<SeedList | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return validateSeedList(JSON.parse(text));
}

async function readCommittedSeedList(): Promise<SeedList> {
  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = resolve(here, "..", "seed-sources.json");
  const text = await readFile(filePath, "utf8");

  return validateSeedList(JSON.parse(text));
}

function validateSeedList(value: unknown): SeedList {
  if (!value || typeof value !== "object") {
    throw new Error("Seed list must be an object.");
  }

  const root = value as { version?: unknown; topics?: unknown };
  if (typeof root.version !== "number") {
    throw new Error("Seed list must have a numeric `version`.");
  }

  if (!Array.isArray(root.topics)) {
    throw new Error("Seed list must have a `topics` array.");
  }

  const topics: SeedTopic[] = [];

  for (const rawTopic of root.topics) {
    if (!rawTopic || typeof rawTopic !== "object") {
      throw new Error("Each topic must be an object.");
    }

    const topic = rawTopic as {
      name?: unknown;
      description?: unknown;
      keywords?: unknown;
      sources?: unknown;
    };

    if (typeof topic.name !== "string" || topic.name.trim() === "") {
      throw new Error("Each topic must have a non-empty `name`.");
    }

    if (
      topic.description !== undefined &&
      typeof topic.description !== "string"
    ) {
      throw new Error("Topic `description` must be a string when present.");
    }

    if (topic.keywords !== undefined && !Array.isArray(topic.keywords)) {
      throw new Error("Topic `keywords` must be an array when present.");
    }

    const rawKeywords = topic.keywords;
    const keywords: string[] = Array.isArray(rawKeywords)
      ? rawKeywords.filter(
          (k): k is string => typeof k === "string" && k.trim() !== "",
        )
      : [];

    if (!Array.isArray(topic.sources)) {
      throw new Error(`Topic "${topic.name}" must have a \`sources\` array.`);
    }

    const sources: SeedSource[] = [];

    for (const rawSource of topic.sources) {
      if (!rawSource || typeof rawSource !== "object") {
        throw new Error(`Each source in topic "${topic.name}" must be an object.`);
      }

      const source = rawSource as { name?: unknown; url?: unknown };

      if (typeof source.name !== "string" || source.name.trim() === "") {
        throw new Error(
          `Each source in topic "${topic.name}" must have a non-empty \`name\`.`,
        );
      }

      if (typeof source.url !== "string" || !isHttpUrl(source.url)) {
        throw new Error(
          `Each source in topic "${topic.name}" must have an http/https \`url\`.`,
        );
      }

      sources.push({ name: source.name, url: source.url });
    }

    const description =
      typeof topic.description === "string" ? topic.description : undefined;

    topics.push({
      name: topic.name,
      description,
      keywords,
      sources,
    });
  }

  return { version: root.version, topics };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readRequiredEnv(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function canonicalizeSeedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
