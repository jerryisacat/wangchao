// Issue #187 - Timeline 全量导出 route.
// 主题时间线全量导出（Markdown/JSON/PDF 三格式复用同一 snapshot）。
// 超过 100 条不静默截断（上限 10000）。大集合（>500）进入 Worker。
import type { ExportFormat } from "@wangchao/core";

interface TimelineExportContext {
  params: Promise<{ topicId: string }> | { topicId: string };
}

const LARGE_COLLECTION_THRESHOLD = 500;

export async function GET(request: Request, context: TimelineExportContext) {
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
    listTimelineEventsForExport,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const {
    checkExportQuota,
    createContentHash,
    buildTimelineExportJson,
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
    input: { format, mode: "timeline-export" },
    organizationId: workspace.organizationId,
    topicId: topic.id,
    type: "EXPORT_GENERATION",
  });

  try {
    const events = await listTimelineEventsForExport(prisma, {
      organizationId: workspace.organizationId,
      topicId: topic.id,
    });

    if (events.length === 0) {
      await completeTaskRun(prisma, taskRun.id, {
        eventCount: 0,
        outcome: "skipped-no-events",
      });
      return new Response("No timeline events available for export.", { status: 404 });
    }

    // 大集合：标记为 deferred，实际生成进入 Worker。
    // 当前同步返回 202 + taskRunId，客户端轮询状态。
    if (events.length > LARGE_COLLECTION_THRESHOLD) {
      await completeTaskRun(prisma, taskRun.id, {
        eventCount: events.length,
        format,
        outcome: "deferred-large-collection",
      });
      return new Response(
        JSON.stringify({
          status: "deferred",
          taskRunId: taskRun.id,
          eventCount: events.length,
          message: "Collection exceeds threshold, generation deferred to worker.",
        }),
        {
          status: 202,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Location": `/api/exports/timeline/${topic.id}/status?taskRunId=${taskRun.id}`,
          },
        },
      );
    }

    const exportEvents = events.map((event) => ({
      eventId: event.eventId,
      title: event.title,
      summary: event.summary,
      category: event.category,
      score: event.score,
      explanation: event.explanation,
      followUpSuggestion: event.followUpSuggestion,
      occurredAt: event.occurredAt,
      entities: event.entities,
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
      url: event.url,
    }));

    let content: string | Uint8Array;
    let fileName: string;
    let contentType: string;

    const slug = slugify(topic.name);
    const datePrefix = generatedAt.toISOString().slice(0, 10);

    if (format === "JSON") {
      const json = buildTimelineExportJson({
        exportedAt: generatedAt,
        topic: { id: topic.id, name: topic.name },
        events: exportEvents,
      });
      content = serializeExportJson(json);
      fileName = `${datePrefix}-timeline-${slug}.json`;
      contentType = "application/json; charset=utf-8";
    } else if (format === "PDF") {
      const { renderTimelinePdf } = await import("@wangchao/core/dist/render-pdf.js");
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
      content = await renderTimelinePdf({
        topicName: topic.name,
        generatedAt: generatedAt.toISOString(),
        events: pdfEvents,
      });
      fileName = `${datePrefix}-timeline-${slug}.pdf`;
      contentType = "application/pdf";
    } else {
      content = buildTimelineMarkdown(topic.name, exportEvents, generatedAt);
      fileName = `${datePrefix}-timeline-${slug}.md`;
      contentType = "text/markdown; charset=utf-8";
    }

    const contentHash = typeof content === "string"
      ? createContentHash(content)
      : createContentHash("");
    await recordMarkdownExport(prisma, {
      contentHash,
      fileName,
      format,
      metadata: { eventCount: events.length, mode: "timeline-export", source: "timeline-export-route" },
      organizationId: workspace.organizationId,
      topicId: topic.id,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: { eventCount: events.length, fileName, format, source: "timeline-export-route" },
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

function buildTimelineMarkdown(
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
    `title: ${JSON.stringify(`${topicName} Timeline Export`)}`,
    `created: ${generatedAt.toISOString()}`,
    `topic: ${JSON.stringify(topicName)}`,
    "format: wangchao-timeline-export",
    `event_count: ${events.length}`,
    "---",
    "",
    `# ${topicName} - Timeline Export`,
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
      .slice(0, 60) || "wangchao-timeline"
  );
}
