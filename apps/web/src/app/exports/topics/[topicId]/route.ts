import { createContentHash } from "@wangchao/core";

interface TopicExportContext {
  params: Promise<{ topicId: string }> | { topicId: string };
}

export async function GET(_request: Request, context: TopicExportContext) {
  const { topicId } = await Promise.resolve(context.params);

  if (!process.env.DATABASE_URL) {
    return new Response("Workspace is not ready for export.", { status: 503 });
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    assertMembershipRole,
    completeTaskRun,
    createTaskRun,
    failTaskRun,
    getMonthExportCount,
    getPrismaClient,
    getSubscriptionPlanView,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { checkExportQuota } = await import("@wangchao/core");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN", "MEMBER"],
  );

  const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
  const monthExports = await getMonthExportCount(prisma, { organizationId: workspace.organizationId });
  const exportQuota = checkExportQuota(subscription.plan, monthExports, subscription.isSelfHosted);
  if (!exportQuota.allowed) return new Response(exportQuota.reason ?? "Export limit reached.", { status: 429 });

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, organizationId: workspace.organizationId },
    select: { id: true, name: true },
  });

  if (!topic) {
    return new Response("Topic not found.", { status: 404 });
  }

  const taskRun = await createTaskRun(prisma, {
    input: { format: "MARKDOWN", mode: "batch-topic" },
    organizationId: workspace.organizationId,
    topicId: topic.id,
    type: "EXPORT_GENERATION",
  });

  try {
    const events = await prisma.intelligenceEvent.findMany({
      where: {
        organizationId: workspace.organizationId,
        topicId: topic.id,
        status: { in: ["UNREAD", "READ", "SAVED"] },
        primaryItem: { source: { status: "ACTIVE" } },
      },
      include: {
        primaryItem: {
          select: {
            url: true,
            source: { select: { name: true, url: true } },
          },
        },
      },
      orderBy: [{ occurredAt: "desc" }, { gravityScore: "desc" }],
      take: 100,
    });

    if (events.length === 0) {
      await completeTaskRun(prisma, taskRun.id, {
        eventCount: 0,
        outcome: "skipped-no-events",
      });
      return new Response("No events available for export.", { status: 404 });
    }

    const generatedAt = new Date();
    const datePrefix = generatedAt.toISOString().slice(0, 10);
    const markdown = buildBatchMarkdown(topic.name, events, generatedAt);
    const fileName = `${datePrefix}-batch-${slugify(topic.name)}.md`;

    await recordMarkdownExport(prisma, {
      contentHash: createContentHash(markdown),
      fileName,
      metadata: { eventCount: events.length, mode: "batch-topic", source: "topic-batch-route" },
      organizationId: workspace.organizationId,
      topicId: topic.id,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: { eventCount: events.length, fileName, source: "topic-batch-route" },
      organizationId: workspace.organizationId,
      quantity: events.length,
      subjectId: topic.id,
      subjectType: "topic",
      type: "EXPORT",
      unit: "event",
      userId: workspace.userId,
    });
    await completeTaskRun(prisma, taskRun.id, {
      eventCount: events.length,
      fileName,
      format: "MARKDOWN",
      outcome: "generated",
    });

    return new Response(markdown, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

function buildBatchMarkdown(
  topicName: string,
  events: Array<{
    id: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    occurredAt: Date | null;
    entities: string[];
    followUpSuggestion: string | null;
    primaryItem: { url: string | null; source: { name: string; url: string } } | null;
  }>,
  generatedAt: Date,
): string {
  const lines: Array<string | undefined> = [
    "---",
    `title: ${JSON.stringify(`${topicName} Batch Export`)}`,
    `created: ${generatedAt.toISOString()}`,
    `topic: ${JSON.stringify(topicName)}`,
    "format: wangchao-batch-export",
    `event_count: ${events.length}`,
    "---",
    "",
    `# ${topicName} — Batch Export`,
    "",
    `Generated at ${generatedAt.toISOString()}. Contains ${events.length} events.`,
    "",
  ];

  for (const event of events) {
    lines.push(
      `## ${event.title}`,
      "",
      event.summary,
      "",
      `- Score: ${Math.round(event.score)}`,
      `- Category: ${event.category ?? "general"}`,
      `- Source: ${event.primaryItem?.source.name ?? "Unknown source"}`,
      event.occurredAt
        ? `- Occurred at: ${event.occurredAt.toISOString()}`
        : undefined,
      event.primaryItem?.url ? `- Original: ${event.primaryItem.url}` : undefined,
      event.entities.length > 0 ? `- Entities: ${event.entities.join(", ")}` : undefined,
      event.explanation ? `- Why it matters: ${event.explanation}` : undefined,
      event.followUpSuggestion ? `- Follow up: ${event.followUpSuggestion}` : undefined,
      "",
      "---",
      "",
    );
  }

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "wangchao-topic"
  );
}
