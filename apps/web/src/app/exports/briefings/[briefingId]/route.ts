interface BriefingRouteContext {
  params: Promise<{ briefingId: string }> | { briefingId: string };
}

export async function GET(_request: Request, context: BriefingRouteContext) {
  const { briefingId } = await Promise.resolve(context.params);
  const { createContentHash } = await import("@wangchao/core");

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
  const briefing = await getBriefingMarkdownForDownload(prisma, {
    briefingId,
    organizationId: workspace.organizationId,
  });

  if (!briefing?.markdown) {
    return new Response("Briefing not found.", { status: 404 });
  }

  const briefingWithDates = await prisma.briefing.findFirst({
    where: { id: briefingId, organizationId: workspace.organizationId },
    select: { period: true, rangeStart: true, generatedAt: true },
  });

  const taskRun = await createTaskRun(prisma, {
    input: {
      briefingId: briefing.id,
      format: "MARKDOWN",
    },
    organizationId: workspace.organizationId,
    topicId: briefing.topicId,
    type: "EXPORT_GENERATION",
  });

  try {
    const fileName = buildBriefingFileName(briefing.title, briefingWithDates ?? undefined);
    await recordMarkdownExport(prisma, {
      briefingId: briefing.id,
      contentHash: createContentHash(briefing.markdown),
      fileName,
      organizationId: workspace.organizationId,
      topicId: briefing.topicId,
      userId: workspace.userId,
    });
    await recordUsageEvent(prisma, {
      metadata: {
        fileName,
        source: "briefing-markdown-route",
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
      format: "MARKDOWN",
      outcome: "generated",
    });

    return markdownResponse(briefing.markdown, fileName);
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

function buildBriefingFileName(
  title: string,
  meta?: { period: string; rangeStart: Date; generatedAt: Date } | null,
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "wangchao-briefing";
  if (meta) {
    const datePart = meta.rangeStart.toISOString().slice(0, 10);
    const periodTag = meta.period.toLowerCase();
    return `${datePart}-${periodTag}-${slug}.md`;
  }
  return `${slug}.md`;
}
