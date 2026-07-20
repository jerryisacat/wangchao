// Issue #187 - Topic batch export route with ?format=json|pdf|markdown support.
// 参考 events route 模式：复用同一 snapshot 生成三格式输出。
// 不再静默截断 100 条（take: 100 移除），全量导出上限 10000。
import type { ExportFormat } from "@wangchao/core";

interface TopicExportContext {
  params: Promise<{ topicId: string }> | { topicId: string };
}

export async function GET(request: Request, context: TopicExportContext) {
  const { topicId } = await Promise.resolve(context.params);
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
    getMonthExportCount,
    getPrismaClient,
    getSubscriptionPlanView,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const {
    checkExportQuota,
    createContentHash,
    buildTopicExportJson,
    serializeExportJson,
    renderEventMarkdown,
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

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, organizationId: workspace.organizationId },
    select: { id: true, name: true },
  });

  if (!topic) {
    return new Response("Topic not found.", { status: 404 });
  }

  const taskRun = await createTaskRun(prisma, {
    input: { format, mode: "batch-topic" },
    organizationId: workspace.organizationId,
    topicId: topic.id,
    type: "EXPORT_GENERATION",
  });

  try {
    // Issue #187: 不再静默截断 100 条。全量导出上限 10000。
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
      take: 10_000,
    });

    if (events.length === 0) {
      await completeTaskRun(prisma, taskRun.id, {
        eventCount: 0,
        outcome: "skipped-no-events",
      });
      return new Response("No events available for export.", { status: 404 });
    }

    const exportEvents = events.map((event) => ({
      eventId: event.id,
      title: event.title,
      summary: event.summary,
      category: event.category,
      score: event.score,
      explanation: event.explanation,
      followUpSuggestion: event.followUpSuggestion,
      occurredAt: event.occurredAt,
      entities: event.entities ?? [],
      sourceName: event.primaryItem?.source.name ?? null,
      sourceUrl: event.primaryItem?.source.url ?? null,
      url: event.primaryItem?.url ?? null,
    }));

    let content: string | Uint8Array;
    let fileName: string;
    let contentType: string;

    const slug = slugify(topic.name);
    const datePrefix = generatedAt.toISOString().slice(0, 10);

    if (format === "JSON") {
      const json = buildTopicExportJson({
        exportedAt: generatedAt,
        topic: { id: topic.id, name: topic.name },
        events: exportEvents,
      });
      content = serializeExportJson(json);
      fileName = `${datePrefix}-batch-${slug}.json`;
      contentType = "application/json; charset=utf-8";
    } else if (format === "PDF") {
      const { renderTopicPdf } = await import("@wangchao/core/dist/render-pdf.js");
      const pdfEvents = exportEvents.map((e) => ({
        title: e.title,
        summary: e.summary,
        category: e.category,
        score: e.score,
        explanation: e.explanation,
        followUpSuggestion: e.followUpSuggestion,
        occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
        entities: e.entities,
        sourceName: e.sourceName,
        sourceUrl: e.sourceUrl,
        url: e.url,
        generatedAt: generatedAt.toISOString(),
        topicName: topic.name,
      }));
      content = await renderTopicPdf({
        topicName: topic.name,
        generatedAt: generatedAt.toISOString(),
        events: pdfEvents,
      });
      fileName = `${datePrefix}-batch-${slug}.pdf`;
      contentType = "application/pdf";
    } else {
      content = buildBatchMarkdown(topic.name, exportEvents, generatedAt);
      fileName = `${datePrefix}-batch-${slug}.md`;
      contentType = "text/markdown; charset=utf-8";
    }

    const contentHash = typeof content === "string"
      ? createContentHash(content)
      : createContentHash("");
    await recordMarkdownExport(prisma, {
      contentHash,
      fileName,
      format,
      metadata: { eventCount: events.length, mode: "batch-topic", source: "topic-batch-route" },
      organizationId: workspace.organizationId,
      topicId: topic.id,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: { eventCount: events.length, fileName, format, source: "topic-batch-route" },
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

function buildBatchMarkdown(
  topicName: string,
  events: Array<{
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    occurredAt: Date | null;
    entities: string[];
    followUpSuggestion: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
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
    `# ${topicName} - Batch Export`,
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
      `- Source: ${event.sourceName ?? "Unknown source"}`,
      event.occurredAt
        ? `- Occurred at: ${event.occurredAt.toISOString()}`
        : undefined,
      event.url ? `- Original: ${event.url}` : undefined,
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
