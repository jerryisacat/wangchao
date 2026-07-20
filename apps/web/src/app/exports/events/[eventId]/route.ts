import type { ExportFormat } from "@wangchao/core";

interface EventRouteContext {
  params: Promise<{ eventId: string }> | { eventId: string };
}

export async function GET(request: Request, context: EventRouteContext) {
  const { eventId } = await Promise.resolve(context.params);
  const url = new URL(request.url);
  const formatParam = (url.searchParams.get("format") ?? "markdown").toLowerCase();
  const format: ExportFormat = formatParam === "json" ? "JSON" : formatParam === "pdf" ? "PDF" : "MARKDOWN";
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
  const {
    checkExportQuota,
    createContentHash,
    renderEventMarkdown,
    buildEventExportJson,
    serializeExportJson,
    resolveEffectivePlanFromView,
  } = await import("@wangchao/core");
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
  const exportQuota = checkExportQuota(resolveEffectivePlanFromView(subscription), monthExports, subscription.isSelfHosted);
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
    input: { format },
    organizationId: workspace.organizationId,
    topicId: event.topicId,
    type: "EXPORT_GENERATION",
  });

  try {
    const { buildEventDisplayFields } = await import("@/lib/event-display");
    const { getSummaryDisplay } = await import("@/lib/summary-status");
    const display = buildEventDisplayFields({
      explanation: event.explanation,
      primaryItemUrl: event.url,
      summary: event.summary,
      title: event.title,
    });
    const summaryDisplay = getSummaryDisplay(event.summaryStatus, display.summary);
    const slug = slugify(event.title);

    let content: string | Uint8Array;
    let fileName: string;
    let contentType: string;

    if (format === "JSON") {
      const json = buildEventExportJson({
        exportedAt: generatedAt,
        topic: { id: event.topicId, name: event.topicName },
        event: {
          eventId: event.eventId,
          title: event.title,
          summary: summaryDisplay.text,
          category: event.category,
          score: event.score,
          explanation: event.explanation,
          followUpSuggestion: event.followUpSuggestion,
          occurredAt: event.occurredAt,
          entities: event.entities ?? [],
          sourceName: event.sourceName,
          sourceUrl: event.sourceUrl,
          url: event.url,
        },
      });
      content = serializeExportJson(json);
      fileName = `${slug}.json`;
      contentType = "application/json; charset=utf-8";
    } else if (format === "PDF") {
      const { renderEventPdf } = await import("@wangchao/core/dist/render-pdf.js");
      content = await renderEventPdf({
        title: event.title,
        summary: summaryDisplay.text,
        category: event.category,
        score: event.score,
        explanation: event.explanation,
        followUpSuggestion: event.followUpSuggestion,
        occurredAt: event.occurredAt ? event.occurredAt.toISOString() : null,
        entities: event.entities ?? [],
        sourceName: event.sourceName,
        sourceUrl: event.sourceUrl,
        url: event.url,
        generatedAt: generatedAt.toISOString(),
        topicName: event.topicName,
      });
      fileName = `${slug}.pdf`;
      contentType = "application/pdf";
    } else {
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
          summary: summaryDisplay.text,
          title: event.title,
          url: event.url,
        },
        generatedAt,
      );
      content = markdown;
      fileName = `${slug}.md`;
      contentType = "text/markdown; charset=utf-8";
    }

    const contentHash = typeof content === "string"
      ? createContentHash(content)
      : createContentHash("");
    await recordMarkdownExport(prisma, {
      contentHash,
      eventId: event.eventId,
      fileName,
      format,
      organizationId: workspace.organizationId,
      topicId: event.topicId,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: {
        fileName,
        format,
        source: "event-export-route",
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
      format,
      outcome: "generated",
    });

    return new Response(
      content instanceof Uint8Array ? new Uint8Array(content) : content,
      {
        headers: {
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": contentType,
        },
      },
    );
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "wangchao-event";
}