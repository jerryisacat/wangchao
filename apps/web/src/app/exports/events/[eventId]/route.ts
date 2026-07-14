interface EventRouteContext {
  params: Promise<{ eventId: string }> | { eventId: string };
}

export async function GET(_request: Request, context: EventRouteContext) {
  const { eventId } = await Promise.resolve(context.params);
  const { createContentHash, renderEventMarkdown } = await import("@wangchao/core");
  const { buildEventDisplayFields } = await import("@/lib/event-display");
  const generatedAt = new Date();

  if (!process.env.DATABASE_URL) {
    return new Response("Workspace is not ready for export.", { status: 503 });
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    assertMembershipRole,
    completeTaskRun,
    createTaskRun,
    failTaskRun,
    getEventMarkdownExportRecord,
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
  const event = await getEventMarkdownExportRecord(prisma, {
    eventId,
    organizationId: workspace.organizationId,
  });

  if (!event) {
    return new Response("Event not found.", { status: 404 });
  }

  const taskRun = await createTaskRun(prisma, {
    eventId: event.eventId,
    input: { format: "MARKDOWN" },
    organizationId: workspace.organizationId,
    topicId: event.topicId,
    type: "EXPORT_GENERATION",
  });

  try {
    const display = buildEventDisplayFields({
      explanation: event.explanation,
      primaryItemUrl: event.url,
      summary: event.summary,
      title: event.title,
    });

    const markdown = renderEventMarkdown(
      {
        category: event.category,
        entities: event.entities ?? undefined,
        explanation: event.explanation,
        followUpSuggestion: event.followUpSuggestion ?? undefined,
        occurredAt: event.occurredAt,
        score: event.score,
        sourceName: event.sourceName,
        sourceUrl: event.sourceUrl,
        summary: display.summary,
        title: event.title,
        url: event.url,
      },
      generatedAt,
    );
    const fileName = `${slugify(event.title)}.md`;

    await recordMarkdownExport(prisma, {
      contentHash: createContentHash(markdown),
      eventId: event.eventId,
      fileName,
      organizationId: workspace.organizationId,
      topicId: event.topicId,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: {
        fileName,
        source: "event-markdown-route",
      },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectId: event.eventId,
      subjectType: "intelligence-event",
      type: "EXPORT",
      unit: "file",
      userId: workspace.userId,
    });
    await completeTaskRun(prisma, taskRun.id, {
      fileName,
      format: "MARKDOWN",
      outcome: "generated",
    });

    return markdownResponse(markdown, fileName);
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

function markdownResponse(markdown: string, fileName: string): Response {
  return new Response(markdown, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "wangchao-event";
}
