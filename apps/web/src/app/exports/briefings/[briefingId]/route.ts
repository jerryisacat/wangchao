interface BriefingRouteContext {
  params: Promise<{ briefingId: string }> | { briefingId: string };
}

export async function GET(_request: Request, context: BriefingRouteContext) {
  const { briefingId } = await Promise.resolve(context.params);
  const { createContentHash } = await import("@wangchao/core");

  if (!process.env.DATABASE_URL) {
    return new Response("Workspace is not ready for export.", { status: 503 });
  }

  const {
    assertMembershipRole,
    completeTaskRun,
    createTaskRun,
    ensureDefaultWorkspace,
    failTaskRun,
    getBriefingMarkdownForDownload,
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
  const briefing = await getBriefingMarkdownForDownload(prisma, {
    briefingId,
    organizationId: workspace.organizationId,
  });

  if (!briefing?.markdown) {
    return new Response("Briefing not found.", { status: 404 });
  }

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
    const fileName = `${slugify(briefing.title)}.md`;
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "wangchao-briefing";
}
