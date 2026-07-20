// Issue #187 - Saved collection export route.
// 当前用户 saved 集合导出（Markdown/JSON/PDF 三格式复用同一 snapshot）。
// 严格 user scoped（UserItemState.saved=true + userId）。大集合（>500）进入 Worker。
import type { ExportFormat } from "@wangchao/core";

const LARGE_COLLECTION_THRESHOLD = 500;

export async function GET(request: Request) {
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
    listSavedEventsForExport,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const {
    checkExportQuota,
    createContentHash,
    buildSavedExportJson,
    serializeExportJson,
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
  const exportQuota = checkExportQuota(subscription.plan, monthExports, subscription.isSelfHosted);
  if (!exportQuota.allowed) return new Response(exportQuota.reason ?? "Export limit reached.", { status: 429 });

  // Saved collection 不绑定具体 topic，使用 organization 级别的占位 topic。
  // 需要一个 topicId 来满足 recordMarkdownExport 的 NOT NULL 约束。
  // 取用户第一个 topic 作为 fallback；如果没有 topic 则返回 404。
  const firstTopic = await prisma.topic.findFirst({
    where: { organizationId: workspace.organizationId },
    select: { id: true, name: true },
  });

  if (!firstTopic) {
    return new Response("No topics found in workspace.", { status: 404 });
  }

  const taskRun = await createTaskRun(prisma, {
    input: { format, mode: "saved-export", userId: workspace.userId },
    organizationId: workspace.organizationId,
    topicId: firstTopic.id,
    type: "EXPORT_GENERATION",
  });

  try {
    const events = await listSavedEventsForExport(prisma, {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    });

    if (events.length === 0) {
      await completeTaskRun(prisma, taskRun.id, {
        eventCount: 0,
        outcome: "skipped-no-events",
      });
      return new Response("No saved events available for export.", { status: 404 });
    }

    // 大集合：标记 deferred，进入 Worker 处理。
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
            "Location": `/api/exports/saved/status?taskRunId=${taskRun.id}`,
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
      url: event.primaryItemUrl,
    }));

    let content: string | Uint8Array;
    let fileName: string;
    let contentType: string;

    const datePrefix = generatedAt.toISOString().slice(0, 10);

    if (format === "JSON") {
      const json = buildSavedExportJson({
        exportedAt: generatedAt,
        topic: { id: "saved-collection", name: "收藏集合" },
        userId: workspace.userId,
        events: exportEvents,
      });
      content = serializeExportJson(json);
      fileName = `${datePrefix}-saved-collection.json`;
      contentType = "application/json; charset=utf-8";
    } else if (format === "PDF") {
      const { renderSavedPdf } = await import("@wangchao/core/dist/render-pdf.js");
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
        topicName: events.find((ev) => ev.eventId === e.eventId)?.topicName ?? "",
      }));
      content = await renderSavedPdf({
        generatedAt: generatedAt.toISOString(),
        events: pdfEvents,
      });
      fileName = `${datePrefix}-saved-collection.pdf`;
      contentType = "application/pdf";
    } else {
      content = buildSavedMarkdown(exportEvents, generatedAt);
      fileName = `${datePrefix}-saved-collection.md`;
      contentType = "text/markdown; charset=utf-8";
    }

    const contentHash = typeof content === "string"
      ? createContentHash(content)
      : createContentHash("");
    await recordMarkdownExport(prisma, {
      contentHash,
      fileName,
      format,
      metadata: { eventCount: events.length, mode: "saved-export", source: "saved-export-route" },
      organizationId: workspace.organizationId,
      topicId: firstTopic.id,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: { eventCount: events.length, fileName, format, source: "saved-export-route" },
      organizationId: workspace.organizationId,
      quantity: events.length,
      subjectId: workspace.userId,
      subjectType: "user",
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

function buildSavedMarkdown(
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
    `title: ${JSON.stringify("Saved Collection Export")}`,
    `created: ${generatedAt.toISOString()}`,
    "format: wangchao-saved-export",
    `event_count: ${events.length}`,
    "---",
    "",
    "# Saved Collection Export",
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
