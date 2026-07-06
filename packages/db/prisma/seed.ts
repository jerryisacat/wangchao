import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: readRequiredEnv("DATABASE_URL"),
  }),
});

async function main() {
  const organizationSlug =
    process.env.WANGCHAO_DEFAULT_ORGANIZATION_SLUG ?? "default";
  const organizationName =
    process.env.WANGCHAO_DEFAULT_ORGANIZATION_NAME ?? "个人工作区";
  const ownerEmail =
    process.env.WANGCHAO_DEFAULT_USER_EMAIL ?? "owner@wangchao.local";
  const ownerName = process.env.WANGCHAO_DEFAULT_USER_NAME ?? "个人用户";
  const seedSourceName =
    process.env.WANGCHAO_SEED_SOURCE_NAME ?? "Hacker News 100+";
  const seedSourceUrl =
    process.env.WANGCHAO_SEED_SOURCE_URL ??
    "https://hnrss.org/newest?points=100";
  const seedSourceCanonicalUrl = canonicalizeSeedUrl(seedSourceUrl);

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

  await prisma.topic.deleteMany({
    where: {
      organizationId: organization.id,
      name: "AI Infrastructure",
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

  const topic = await prisma.topic.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "AI 基础设施",
      },
    },
    update: {
      description: "关注 AI 基础设施、模型供应商、Agent 平台和部署生态。",
      profile: {
        keywords: ["AI", "infrastructure", "agents", "模型", "算力"],
      },
    },
    create: {
      organizationId: organization.id,
      ownerUserId: user.id,
      name: "AI 基础设施",
      description: "关注 AI 基础设施、模型供应商、Agent 平台和部署生态。",
      profile: {
        keywords: ["AI", "infrastructure", "agents", "模型", "算力"],
      },
    },
  });

  await prisma.source.upsert({
    where: {
      topicId_canonicalUrl: {
        topicId: topic.id,
        canonicalUrl: seedSourceCanonicalUrl,
      },
    },
    update: { status: "ACTIVE" },
    create: {
      organizationId: organization.id,
      topicId: topic.id,
      kind: "RSS",
      status: "ACTIVE",
      name: seedSourceName,
      url: seedSourceUrl,
      canonicalUrl: seedSourceCanonicalUrl,
      description: "默认关注的公开 RSS 信源，可通过环境变量替换。",
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

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
