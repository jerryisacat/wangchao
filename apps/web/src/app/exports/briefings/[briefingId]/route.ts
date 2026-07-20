// Issue #187 - Briefing export route with ?format=json|pdf|markdown support.
// 参考 events route 模式：读 ?format= query param，三格式复用同一 snapshot。
import type { ExportFormat } from "@wangchao/core";

interface BriefingRouteContext {
  params: Promise<{ briefingId: string }> | { briefingId: string };
}

export async function GET(request: Request, context: BriefingRouteContext) {
  const { briefingId } = await Promise.resolve(context.params);
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
    getBriefingMarkdownForDownload,
    getMonthExportCount,
    getPrismaClient,
    getSubscriptionPlanView,
    recordMarkdownExport,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const {
    checkExportQuota,
    createContentHash,
    buildBriefingExportJson,
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
  const briefing = await getBriefingMarkdownForDownload(prisma, {
    briefingId,
    organizationId: workspace.organizationId,
  });

  if (!briefing?.markdown) {
    return new Response("Briefing not found.", { status: 404 });
  }

  const briefingWithDates = await prisma.briefing.findFirst({
    where: { id: briefingId, organizationId: workspace.organizationId },
    select: {
      period: true,
      rangeStart: true,
      rangeEnd: true,
      generatedAt: true,
      title: true,
      topicId: true,
      events: {
        select: {
          id: true,
          title: true,
          occurredAt: true,
          primaryItem: { select: { url: true } },
        },
      },
    },
  });

  if (!briefingWithDates) {
    return new Response("Briefing not found.", { status: 404 });
  }

  // 获取 topic name
  const topic = await prisma.topic.findFirst({
    where: { id: briefingWithDates.topicId, organizationId: workspace.organizationId },
    select: { id: true, name: true },
  });

  if (!topic) {
    return new Response("Topic not found.", { status: 404 });
  }

  const taskRun = await createTaskRun(prisma, {
    input: {
      briefingId: briefing.id,
      format,
    },
    organizationId: workspace.organizationId,
    topicId: briefing.topicId,
    type: "EXPORT_GENERATION",
  });

  try {
    let content: string | Uint8Array;
    let fileName: string;
    let contentType: string;

    const slug = slugify(briefing.title);
    const datePart = briefingWithDates.rangeStart.toISOString().slice(0, 10);
    const periodTag = briefingWithDates.period.toLowerCase();
    const baseName = `${datePart}-${periodTag}-${slug}`;

    if (format === "JSON") {
      const json = buildBriefingExportJson({
        exportedAt: generatedAt,
        topic: { id: topic.id, name: topic.name },
        briefing: {
          briefingId: briefing.id,
          title: briefing.title,
          period: briefingWithDates.period,
          rangeStart: briefingWithDates.rangeStart,
          rangeEnd: briefingWithDates.rangeEnd,
          generatedAt: briefingWithDates.generatedAt,
          markdown: briefing.markdown,
          events: briefingWithDates.events.map((be) => ({
            eventId: be.id,
            title: be.title,
            occurredAt: be.occurredAt,
          })),
        },
      });
      content = serializeExportJson(json);
      fileName = `${baseName}.json`;
      contentType = "application/json; charset=utf-8";
    } else if (format === "PDF") {
      const { renderBriefingPdf } = await import("@wangchao/core/dist/render-pdf.js");
      content = await renderBriefingPdf({
        title: briefing.title,
        period: briefingWithDates.period,
        rangeStart: briefingWithDates.rangeStart.toISOString(),
        rangeEnd: briefingWithDates.rangeEnd.toISOString(),
        generatedAt: briefingWithDates.generatedAt.toISOString(),
        markdown: briefing.markdown,
        events: briefingWithDates.events.map((be) => ({
          title: be.title,
          url: be.primaryItem?.url ?? null,
          occurredAt: be.occurredAt ? be.occurredAt.toISOString() : null,
        })),
        topicName: topic.name,
      });
      fileName = `${baseName}.pdf`;
      contentType = "application/pdf";
    } else {
      content = briefing.markdown;
      fileName = `${baseName}.md`;
      contentType = "text/markdown; charset=utf-8";
    }

    const contentHash = typeof content === "string"
      ? createContentHash(content)
      : createContentHash("");
    await recordMarkdownExport(prisma, {
      briefingId: briefing.id,
      contentHash,
      fileName,
      format,
      organizationId: workspace.organizationId,
      topicId: briefing.topicId,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: {
        fileName,
        format,
        source: "briefing-export-route",
      },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectId: briefing.id,
      subjectType: "briefing",
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
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "wangchao-briefing";
  return slug;
}