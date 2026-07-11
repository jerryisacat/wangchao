export interface ReportSummary {
  id: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  summary: string | null;
  markdown: string | null;
  coverageNote: string | null;
  eventCount: number;
  topicIds: string[];
  sourceIds: string[];
  generatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ReportsPage {
  reports: ReportSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export async function getReportsPage(
  requestedPage: number,
  pageSize = 20,
): Promise<ReportsPage> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { ensureDefaultWorkspace, getPrismaClient, listReports } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const result = await listReports(
    prisma,
    { organizationId: workspace.organizationId },
    requestedPage,
    pageSize,
  );

  return {
    reports: result.reports.map((report) => ({
      coverageNote: report.coverageNote,
      createdAt: report.createdAt,
      errorMessage: report.errorMessage,
      eventCount: report.eventCount,
      generatedAt: report.generatedAt,
      id: report.id,
      markdown: report.markdown,
      question: report.question,
      sourceIds: report.sourceIds,
      status: report.status,
      summary: report.summary,
      topicIds: report.topicIds,
    })),
    page: result.page,
    pageCount: result.pageCount,
    pageSize,
    total: result.total,
  };
}

export async function getReportDetail(
  reportId: string,
): Promise<ReportSummary | null> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { ensureDefaultWorkspace, getPrismaClient, getReport } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const report = await getReport(
    prisma,
    { organizationId: workspace.organizationId },
    reportId,
  );

  if (!report) {
    return null;
  }

  return {
    coverageNote: report.coverageNote,
    createdAt: report.createdAt,
    errorMessage: report.errorMessage,
    eventCount: report.eventCount,
    generatedAt: report.generatedAt,
    id: report.id,
    markdown: report.markdown,
    question: report.question,
    sourceIds: report.sourceIds,
    status: report.status,
    summary: report.summary,
    topicIds: report.topicIds,
  };
}
