import { type EventExtractionAdapter } from "@wangchao/ai";
import {
  completeReport,
  completeInsufficientReport,
  completeTaskRun,
  collectReportEvidence,
  createTaskRun,
  failReport,
  failTaskRun,
  getPrismaClient,
  listPendingReports,
  recordUsageEvent,
  updateReportStatus,
  type ReportEvidenceSet,
} from "@wangchao/db";
import { isCycleShuttingDown, isCycleTimeExhausted, resetCycleStartTime } from "./lifecycle.js";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import type { ReportGenerationCycleResult, ReportGenerationInput } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * Minimal structural shape of a Report row as read by runReportGeneration.
 * Kept loose (no Prisma-generated types) so fakes in report.fixtures.ts can
 * satisfy it without spinning up the full Prisma client.
 */
interface ReportRow {
  id: string;
  organizationId: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
}

interface CompletedTaskRunLike {
  id: string;
}

/**
 * Injectable dependencies for runReportGeneration. Production callers omit
 * `deps` and rely on module-level imports; tests pass a fake prisma + stubbed
 * db ops + a `resolveAiRuntime` hook so the orchestration can be exercised
 * without a real database or LLM adapter.
 *
 * Function signatures are intentionally structural (loose) rather than
 * `typeof <db export>`: the real db functions return rich Prisma row objects,
 * but the orchestration only reads a handful of fields. Keeping the dep
 * signatures minimal lets fakes stay small and readable.
 */
export interface ReportGenerationDeps {
  prisma: PrismaClient;
  updateReportStatus: (prisma: PrismaClient, reportId: string, status: "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA") => Promise<void>;
  completeReport: (prisma: PrismaClient, reportId: string, input: {
    markdown: string;
    summary: string;
    eventCount: number;
    itemCount: number;
    topicIds: string[];
    sourceIds: string[];
    coverageNote: string;
    metadata?: unknown;
  }) => Promise<void>;
  completeInsufficientReport: (prisma: PrismaClient, reportId: string, input: {
    markdown: string;
    summary: string;
    eventCount: number;
    itemCount: number;
    topicIds: string[];
    sourceIds: string[];
    coverageNote: string;
    metadata?: unknown;
  }) => Promise<void>;
  failReport: (prisma: PrismaClient, reportId: string, errorMessage: string) => Promise<void>;
  createTaskRun: (prisma: PrismaClient, input: { input: unknown; organizationId: string; type: string }) => Promise<CompletedTaskRunLike>;
  completeTaskRun: (prisma: PrismaClient, taskRunId: string, output: Record<string, unknown>) => Promise<void>;
  failTaskRun: (prisma: PrismaClient, taskRunId: string, error: unknown) => Promise<void>;
  collectReportEvidence: (prisma: PrismaClient, scope: { organizationId: string }, query: { keywords: string[]; limit?: number }) => Promise<ReportEvidenceSet>;
  recordUsageEvent: (prisma: PrismaClient, input: Record<string, unknown>) => Promise<void>;
  resolveAiRuntime: (
    prisma: PrismaClient,
    organizationId: string,
  ) => Promise<{ adapter: EventExtractionAdapter; model: string } | null>;
}

export async function runReportGeneration(
  input: ReportGenerationInput,
  deps?: ReportGenerationDeps,
): Promise<void> {
  const prisma = deps?.prisma ?? (process.env.DATABASE_URL ? getPrismaClient() : null);
  if (!prisma) {
    throw new Error("Database connection is required to generate reports.");
  }
  const updateStatus = deps?.updateReportStatus ?? updateReportStatus;
  const complete = deps?.completeReport ?? completeReport;
  const completeInsufficient = deps?.completeInsufficientReport ?? completeInsufficientReport;
  const fail = deps?.failReport ?? failReport;
  const createRun = deps?.createTaskRun ?? createTaskRun;
  const completeRun = deps?.completeTaskRun ?? completeTaskRun;
  const failRun = deps?.failTaskRun ?? failTaskRun;
  const collectEvidence = deps?.collectReportEvidence ?? collectReportEvidence;
  const recordUsage = deps?.recordUsageEvent ?? recordUsageEvent;
  const resolveAiRuntime = deps?.resolveAiRuntime ?? createAnalysisRuntimeWithPlan;

  const report = (await prisma.report.findFirst({
    where: {
      id: input.reportId,
      organizationId: input.organizationId,
    },
  })) as ReportRow | null;

  if (!report) {
    throw new Error("Report not found.");
  }
  if (report.status !== "PENDING") {
    return;
  }

  await updateStatus(prisma, report.id, "GENERATING");

  const taskRun = await createRun(prisma, {
    input: { reportId: report.id, question: report.question },
    organizationId: input.organizationId,
    type: "REPORT_GENERATION",
  });

  try {
    const keywords = extractReportKeywords(report.question);
    // Issue #178: recall the full traceable evidence set - events, Item bodies
    // (via EventItem), and Briefings that overlap the events. No network calls;
    // this only reads what the worker has already ingested.
    const evidence = await collectEvidence(
      prisma,
      { organizationId: input.organizationId },
      { keywords, limit: 30 },
    );

    if (evidence.eventCount < 3) {
      await completeInsufficient(prisma, report.id, {
        markdown: buildInsufficientDataReport(report.question, evidence),
        summary: "情报库中没有足够的相关信息来生成专题报告。",
        eventCount: evidence.eventCount,
        itemCount: evidence.itemCount,
        topicIds: evidence.topicIds,
        sourceIds: evidence.sourceIds,
        coverageNote: `情报库中仅找到 ${evidence.eventCount} 条相关事件（建议阈值 ≥ 3）。建议创建相关主题或补充信源。`,
        metadata: {
          keywords,
          threshold: 3,
          evidenceIds: evidence.evidenceIds,
          itemCount: evidence.itemCount,
          briefingCount: evidence.briefingCount,
        },
      });
      await completeRun(prisma, taskRun.id, {
        outcome: "insufficient-data",
        eventCount: evidence.eventCount,
      });
      return;
    }

    const aiRuntime = await resolveAiRuntime(prisma, input.organizationId);
    const ai = aiRuntime
      ? { adapter: aiRuntime.adapter, model: aiRuntime.model }
      : null;
    let markdown: string;
    if (ai) {
      markdown = await generateReportWithAi(ai, report.question, evidence);
    } else {
      markdown = generateReportRuleBased(report.question, evidence);
    }

    const summary = markdown.slice(0, 200).replace(/\n/g, " ").trim();

    await complete(prisma, report.id, {
      markdown,
      summary,
      eventCount: evidence.eventCount,
      itemCount: evidence.itemCount,
      topicIds: evidence.topicIds,
      sourceIds: evidence.sourceIds,
      coverageNote: `报告基于情报库中 ${evidence.eventCount} 条相关事件、${evidence.itemCount} 条正文证据和 ${evidence.briefingCount} 份相关简报生成，涉及 ${evidence.topicIds.length} 个主题和 ${evidence.sourceIds.length} 个信源。`,
      metadata: {
        keywords,
        evidenceIds: evidence.evidenceIds,
        topicsInvolved: evidence.topicIds.length,
        sourcesInvolved: evidence.sourceIds.length,
        itemCount: evidence.itemCount,
        briefingCount: evidence.briefingCount,
        usedAi: Boolean(ai),
      },
    });
    await completeRun(prisma, taskRun.id, {
      outcome: "completed",
      eventCount: evidence.eventCount,
      itemCount: evidence.itemCount,
      briefingCount: evidence.briefingCount,
    });

    await recordUsage(prisma, {
      metadata: {
        keywords,
        reportId: report.id,
        source: "worker-report-generation",
        usedAi: Boolean(ai),
      },
      organizationId: input.organizationId,
      quantity: 1,
      subjectId: report.id,
      subjectType: "report",
      type: "AI_CALL",
      unit: "report",
      userId: input.userId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await fail(prisma, report.id, errorMessage);
    await failRun(prisma, taskRun.id, error);
    throw error;
  }
}

export async function runReportGenerationCycle(
  limit = 10,
): Promise<ReportGenerationCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to generate reports.");
  }
  resetCycleStartTime();
  const prisma = getPrismaClient();
  const pending = await listPendingReports(prisma, limit);
  const result: ReportGenerationCycleResult = { scanned: pending.length, generated: 0, failed: 0 };
  for (const report of pending) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    try {
      await runReportGeneration({
        reportId: report.id,
        organizationId: report.organizationId,
        userId: "report-cron",
      });
      result.generated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

function extractReportKeywords(question: string): string[] {
  const cleaned = question
    .replace(/[？?！!。，,.;:：、\s]+/g, " ")
    .trim();
  const terms = cleaned
    .split(" ")
    .filter((term) => term.length >= 2)
    .filter((term) => !REPORT_STOP_WORDS.has(term.toLowerCase()));

  const cjkPhrases = [...question.matchAll(/[\u4e00-\u9fff]{2,10}/g)].map((m) => m[0]);

  return Array.from(new Set([...terms, ...cjkPhrases]))
    .map((keyword) => keyword.slice(0, 40))
    .slice(0, 10);
}

const REPORT_STOP_WORDS = new Set([
  "怎么样",
  "怎么样了",
  "现在",
  "目前",
  "最新",
  "情况",
  "状态",
  "如何",
  "什么",
  "有哪些",
  "关于",
  "最近",
  "今天",
  "昨天",
  "这个",
  "那个",
  "they",
  "them",
  "what",
  "how",
  "when",
  "where",
  "why",
  "the",
  "and",
]);

function buildInsufficientDataReport(
  question: string,
  evidence: ReportEvidenceSet,
): string {
  const lines = [
    `# ${question}`,
    "",
    "## 当前情报库覆盖不足",
    "",
    `望潮情报库中关于此问题的相关信息不足（仅找到 ${evidence.eventCount} 条相关事件），无法生成完整专题报告。`,
    "",
    "### 建议",
    "",
    "- 创建更精准的关注主题，覆盖此问题",
    "- 为相关主题补充更多信源",
    "- 等待系统后续抓取周期积累更多信息",
  ];

  if (evidence.events.length > 0) {
    lines.push("", "### 已找到的相关事件", "");
    for (const event of evidence.events.slice(0, 5)) {
      lines.push(`- **${event.title}** - ${event.summary.slice(0, 100)}`);
      if (event.sourceName) {
        lines.push(`  - 来源: ${event.sourceName}`);
      }
    }
  }

  if (evidence.evidenceIds.length > 0) {
    lines.push("", "### 已召回证据 ID", "");
    lines.push(`> ${evidence.evidenceIds.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function generateReportRuleBased(
  question: string,
  evidence: ReportEvidenceSet,
): string {
  const events = evidence.events;
  const now = new Date();
  const lines: Array<string | undefined> = [
    "---",
    `title: ${JSON.stringify(question)}`,
    `created: ${now.toISOString()}`,
    "format: wangchao-topic-report",
    `events: ${evidence.eventCount}`,
    `items: ${evidence.itemCount}`,
    `briefings: ${evidence.briefingCount}`,
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${evidence.eventCount} 条相关事件、${evidence.itemCount} 条正文证据和 ${evidence.briefingCount} 份相关简报生成 · ${now.toISOString()}`,
    "",
    "## 1. 摘要判断",
    "",
    `本报告基于望潮情报库中已抓取并分析的 ${evidence.eventCount} 条情报事件，围绕"${question}"提供当前态势概览。报告仅基于已有情报，不做推测，不联网补全。`,
    "",
    "## 2. 最近关键进展",
    "",
  ];

  for (const [index, event] of events.slice(0, 10).entries()) {
    lines.push(`### ${index + 1}. ${event.title}`, "");
    lines.push(event.summary);
    lines.push("");
    lines.push(`- 主题: ${event.topicName}`);
    if (event.sourceName) {
      lines.push(`- 来源: ${event.sourceName}`);
    }
    if (event.sourceUrl) {
      lines.push(`- 来源链接: ${event.sourceUrl}`);
    }
    if (event.occurredAt) {
      lines.push(`- 时间: ${event.occurredAt.toISOString()}`);
    }
    if (event.sourceTrustScore !== null) {
      lines.push(`- 信源可信度: ${event.sourceTrustScore.toFixed(2)}`);
    }
    lines.push(`- 证据编号: E${index + 1} (${event.eventId})`);
    lines.push("");
  }

  if (events.length > 10) {
    lines.push(`> 还有 ${events.length - 10} 条事件未在此列出。`, "");
  }

  if (evidence.items.length > 0) {
    lines.push("## 3. 正文证据", "");
    for (const [index, item] of evidence.items.slice(0, 10).entries()) {
      lines.push(`### 证据 I${index + 1}: ${item.title}`, "");
      if (item.rawContent) {
        const snippet = item.rawContent.slice(0, 800);
        lines.push(snippet);
        if (item.rawContent.length > 800) {
          lines.push(`\n> 正文已截断（原始长度 ${item.rawContent.length} 字符）。`);
        }
        lines.push("");
      }
      lines.push(`- 链接: ${item.url}`);
      if (item.publishedAt) {
        lines.push(`- 发布时间: ${item.publishedAt.toISOString()}`);
      }
      if (item.sourceName) {
        lines.push(`- 来源: ${item.sourceName}`);
      }
      if (item.sourceTrustScore !== null) {
        lines.push(`- 信源可信度: ${item.sourceTrustScore.toFixed(2)}`);
      }
      lines.push(`- 证据编号: I${index + 1} (${item.itemId})`, "");
    }
  }

  if (evidence.briefings.length > 0) {
    lines.push("## 4. 相关简报", "");
    for (const briefing of evidence.briefings.slice(0, 5)) {
      lines.push(`- ${briefing.title}（${briefing.period}）`);
    }
    lines.push("");
  }

  lines.push("## 5. 信息来源与可信度", "");
  const sources = Array.from(
    new Set(events.map((e) => e.sourceName).filter((s): s is string => Boolean(s))),
  );
  for (const source of sources.slice(0, 10)) {
    lines.push(`- ${source}`);
  }
  lines.push("");

  lines.push(
    "## 6. 信息覆盖不足",
    "",
    "本报告仅基于望潮情报库中已有信息，可能存在覆盖不足。情报库中没有的信息不会出现在报告中。不联网补全，不推测未提供的细节。",
    "",
    "## 7. 建议后续关注点",
    "",
    "- 持续关注相关主题的最新抓取",
    "- 补充更多信源以提升覆盖面",
    "- 利用 AI 重新生成获取更深度的分析（需要配置 AI 凭证）",
  );

  return `${lines.filter((l): l is string => l !== undefined).join("\n")}\n`;
}

async function generateReportWithAi(
  ai: { adapter: EventExtractionAdapter; model: string },
  question: string,
  evidence: ReportEvidenceSet,
): Promise<string> {
  const systemPrompt = `你是一个专业的情报分析师。基于用户提供的情报事件与正文证据，围绕用户问题生成一份结构化的中文专题报告。

要求：
1. 只使用提供的证据作为信息来源，不编造信息，不联网补全，不推测未提供的内容。
2. 如果信息不足，明确说明覆盖不足，不补全推测。
3. 报告格式为 Markdown，包含以下章节：
   ## 1. 摘要判断
   ## 2. 最近关键进展
   ## 3. 主要参与方与立场
   ## 4. 时间线
   ## 5. 影响分析
   ## 6. 信息来源与可信度
   ## 7. 当前情报库覆盖不足
   ## 8. 建议后续关注点
4. 关键判断必须关联具体证据，使用证据编号引用（如 [E1]、[I2]、[B1]）。`;

  const eventsContext = evidence.events
    .slice(0, 20)
    .map(
      (e, i) =>
        `[E${i + 1}] ${e.title}\n证据ID: ${e.eventId}\n摘要: ${e.summary}\n来源: ${e.sourceName ?? "未知"}\n来源链接: ${e.sourceUrl ?? "未知"}\n信源可信度: ${e.sourceTrustScore ?? "未知"}\n主题: ${e.topicName}\n时间: ${e.occurredAt?.toISOString() ?? "未知"}\n评分: ${Math.round(e.score)}`,
    )
    .join("\n\n");

  const itemsContext = evidence.items.length > 0
    ? "\n\n## 正文证据\n\n" +
      evidence.items
        .slice(0, 15)
        .map(
          (it, i) =>
            `[I${i + 1}] ${it.title}\n证据ID: ${it.itemId}\n链接: ${it.url}\n来源: ${it.sourceName ?? "未知"}\n信源可信度: ${it.sourceTrustScore ?? "未知"}\n发布时间: ${it.publishedAt?.toISOString() ?? "未知"}\n正文: ${(it.rawContent ?? "").slice(0, 800)}`,
        )
        .join("\n\n")
    : "";

  const briefingsContext = evidence.briefings.length > 0
    ? "\n\n## 相关简报\n\n" +
      evidence.briefings
        .slice(0, 5)
        .map(
          (b, i) =>
            `[B${i + 1}] ${b.title}（${b.period}）\n证据ID: ${b.briefingId}\n生成时间: ${b.generatedAt?.toISOString() ?? "未知"}\n内容: ${(b.markdown ?? "").slice(0, 500)}`,
        )
        .join("\n\n")
    : "";

  const userPrompt = `问题：${question}\n\n相关情报事件（共 ${evidence.eventCount} 条）：\n\n${eventsContext}${itemsContext}${briefingsContext}\n\n请仅基于以上证据生成报告，禁止联网补全，关键判断必须用证据编号引用。`;

  const response = await ai.adapter.chat({
    maxTokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model: ai.model,
    temperature: 0.3,
  });

  const now = new Date();
  const header = [
    "---",
    `title: ${JSON.stringify(question)}`,
    `created: ${now.toISOString()}`,
    "format: wangchao-topic-report",
    `events: ${evidence.eventCount}`,
    `items: ${evidence.itemCount}`,
    `briefings: ${evidence.briefingCount}`,
    "ai_generated: true",
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${evidence.eventCount} 条相关事件、${evidence.itemCount} 条正文证据和 ${evidence.briefingCount} 份相关简报由 AI 生成 · ${now.toISOString()}`,
    "",
  ].join("\n");

  return `${header}\n${response.content.trim()}\n`;
}
