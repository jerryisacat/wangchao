interface EventRouteContext {
  params: Promise<{ eventId: string }> | { eventId: string };
}

export async function GET(_request: Request, context: EventRouteContext) {
  const { eventId } = await Promise.resolve(context.params);
  const { createContentHash, renderEventMarkdown } = await import("@wangchao/core");
  const generatedAt = new Date();

  if (!process.env.DATABASE_URL) {
    return new Response("Workspace is not ready for export.", { status: 503 });
  }

  const {
    assertMembershipRole,
    ensureDefaultWorkspace,
    getEventMarkdownExportRecord,
    getPrismaClient,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);

  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN", "MEMBER"],
  );
  const event = await getEventMarkdownExportRecord(prisma, {
    eventId,
    organizationId: workspace.organizationId,
  });

  if (!event) {
    return new Response("Event not found.", { status: 404 });
  }

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
      summary: event.summary,
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

  return markdownResponse(markdown, fileName);
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
