import type { Prisma, PrismaClient } from "@prisma/client";
import { toInputJson } from "./util.js";
import type {
  CreateTopicInput,
  OrganizationMembershipRecord,
  SourceDiscoveryTopicRecord,
  TenantScope,
  TopicDetailRecord,
  TopicListItem,
  TopicScope,
  UpdateTopicInput,
} from "./types.js";

export async function createTopic(
  prisma: PrismaClient,
  scope: TenantScope,
  input: CreateTopicInput & { ownerUserId?: string },
) {
  return prisma.topic.create({
    data: {
      organizationId: scope.organizationId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description,
      profile: toInputJson(input.profile),
      status: "ACTIVE",
    },
  });
}

export async function listOrganizationMemberships(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<OrganizationMembershipRecord[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return memberships.map((membership) => ({
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
    userId: membership.user.id,
  }));
}

export async function assertMembershipRole(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  allowedRoles: Array<"OWNER" | "ADMIN" | "MEMBER">,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
    },
    select: {
      role: true,
    },
  });

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Error("User is not authorized for this organization.");
  }

  return membership;
}

export async function listActiveTopics(prisma: PrismaClient, scope: TenantScope) {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listTopicsForSourceDiscovery(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SourceDiscoveryTopicRecord[]> {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      description: true,
      id: true,
      name: true,
      organizationId: true,
      profile: true,
    },
  });
}

export async function listTopicSourceOverview(
  prisma: PrismaClient,
  scope: TenantScope,
) {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    include: {
      sources: {
        orderBy: { updatedAt: "desc" },
      },
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listActiveSources(prisma: PrismaClient, scope: TopicScope) {
  return prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTopicById(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
): Promise<TopicDetailRecord | null> {
  const topic = await prisma.topic.findFirst({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
    include: {
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
          briefings: true,
        },
      },
    },
  });

  if (!topic) {
    return null;
  }

  return {
    briefingCount: topic._count.briefings,
    createdAt: topic.createdAt,
    description: topic.description,
    eventCount: topic._count.intelligenceEvents,
    id: topic.id,
    name: topic.name,
    organizationId: topic.organizationId,
    ownerUserId: topic.ownerUserId,
    profile: topic.profile,
    sourceCount: topic._count.sources,
    status: topic.status,
    updatedAt: topic.updatedAt,
  };
}

export async function listAllTopics(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<TopicListItem[]> {
  const topics = await prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return topics.map((topic) => ({
    createdAt: topic.createdAt,
    description: topic.description,
    eventCount: topic._count.intelligenceEvents,
    id: topic.id,
    name: topic.name,
    sourceCount: topic._count.sources,
    status: topic.status,
    updatedAt: topic.updatedAt,
  }));
}

export async function updateTopic(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
  input: UpdateTopicInput,
) {
  const existing = await prisma.topic.findFirst({
    where: { id: scope.topicId, organizationId: scope.organizationId },
  });
  if (!existing) {
    throw new Error(`Topic ${scope.topicId} not found in organization ${scope.organizationId}`);
  }

  const data: Prisma.TopicUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
  }
  if (input.description !== undefined) {
    data.description = input.description;
  }
  if (input.profile !== undefined) {
    data.profile = toInputJson(input.profile);
  }

  return prisma.topic.update({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
    data,
  });
}

export async function updateTopicStatus(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  const existing = await prisma.topic.findFirst({
    where: { id: scope.topicId, organizationId: scope.organizationId },
  });
  if (!existing) {
    throw new Error(`Topic ${scope.topicId} not found in organization ${scope.organizationId}`);
  }

  return prisma.topic.update({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
    data: { status },
  });
}

export async function deleteTopic(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
) {
  const existing = await prisma.topic.findFirst({
    where: { id: scope.topicId, organizationId: scope.organizationId },
  });
  if (!existing) {
    throw new Error(`Topic ${scope.topicId} not found in organization ${scope.organizationId}`);
  }

  return prisma.topic.delete({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
  });
}
