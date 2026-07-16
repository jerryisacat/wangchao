import { type EventExtractionAdapter } from "@wangchao/ai";
import {
  completeReport,
  completeTaskRun,
  createTaskRun,
  failReport,
  failTaskRun,
  getPrismaClient,
  listPendingReports,
  recordUsageEvent,
  searchReportEvidenceEvents,
  updateReportStatus,
} from "@wangchao/db";
import { isCycleShuttingDown, isCycleTimeExhausted, resetCycleStartTime } from "./lifecycle.js";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import type { ReportGenerationCycleResult, ReportGenerationInput } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

export async function runReportGeneration(
  input: ReportGenerationInput,
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to generate reports.");
  }

  const prisma = getPrismaClient();
  const report = await prisma.report.findFirst({
    where: {
      id: input.reportId,
      organizationId: input.organizationId,
    },
  });

  if (!report) {
    throw new Error("Report not found.");
  }
  if (report.status !== "PENDING") {
    return;
  }

  await updateReportStatus(prisma, report.id, "GENERATING");

  const taskRun = await createTaskRun(prisma, {
    input: { reportId: report.id, question: report.question },
    organizationId: input.organizationId,
    type: "REPORT_GENERATION",
  });

  try {
    const keywords = extractReportKeywords(report.question);
    const events = await searchReportEvidenceEvents(
      prisma,
      { organizationId: input.organizationId },
      { keywords, limit: 30 },
    );

    if (events.length < 3) {
      await completeReport(prisma, report.id, {
        markdown: buildInsufficientDataReport(report.question, events),
        summary: "情报库中没有足够的相关信息来生成专题报告。",
        eventCount: events.length,
        itemCount: 0,
        topicIds: Array.from(new Set(events.map((e) => e.topicId))),
        sourceIds: Array.from(new Set(events.map((e) => e.sourceId).filter(Boolean))) as string[],
        coverageNote: `情报库中仅找到 ${events.length} 条相关事件（建议阈值 ≥ 3）。建议创建相关主题或补充信源。`,
        metadata: { keywords, threshold: 3 },
      });
      await completeTaskRun(prisma, taskRun.id, {
        outcome: "insufficient-data",
        eventCount: events.length,
      });
      return;
    }

    const aiRuntime = await createAnalysisRuntimeWithPlan(
      prisma,
      input.organizationId,
    );
    const ai = aiRuntime
      ? { adapter: aiRuntime.adapter, model: aiRuntime.model }
      : null;
    let markdown: string;
    if (ai) {
      markdown = await generateReportWithAi(ai, report.question, events);
    } else {
      markdown = generateReportRuleBased(report.question, events);
    }

    const summary = markdown.slice(0, 200).replace(/\n/g, " ").trim();
    const topicIds = Array.from(new Set(events.map((e) => e.topicId)));
    const sourceIds = Array.from(
      new Set(events.map((e) => e.sourceId).filter((id): id is string => Boolean(id))),
    );

    await completeReport(prisma, report.id, {
      markdown,
      summary,
      eventCount: events.length,
      itemCount: events.length,
      topicIds,
      sourceIds,
      coverageNote: `报告基于情报库中 ${events.length} 条相关事件生成，涉及 ${topicIds.length} 个主题和 ${sourceIds.length} 个信源。`,
      metadata: {
        keywords,
        topicsInvolved: topicIds.length,
        sourcesInvolved: sourceIds.length,
        usedAi: Boolean(ai),
      },
    });
    await completeTaskRun(prisma, taskRun.id, {
      outcome: "completed",
      eventCount: events.length,
    });

    await recordUsageEvent(prisma, {
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
    await failReport(prisma, report.id, errorMessage);
    await failTaskRun(prisma, taskRun.id, error);
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
  events: Array<{ title: string; summary: string; sourceName: string | null }>,
): string {
  const lines = [
    `# ${question}`,
    "",
    "## 当前情报库覆盖不足",
    "",
    `望潮情报库中关于此问题的相关信息不足（仅找到 ${events.length} 条相关事件），无法生成完整专题报告。`,
    "",
    "### 建议",
    "",
    "- 创建更精准的关注主题，覆盖此问题",
    "- 为相关主题补充更多信源",
    "- 等待系统后续抓取周期积累更多信息",
  ];

  if (events.length > 0) {
    lines.push("", "### 已找到的相关事件", "");
    for (const event of events.slice(0, 5)) {
      lines.push(`- **${event.title}** - ${event.summary.slice(0, 100)}`);
      if (event.sourceName) {
        lines.push(`  - 来源: ${event.sourceName}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function generateReportRuleBased(
  question: string,
  events: Array<{
    title: string;
    summary: string;
    category: string | null;
    score: number;
    occurredAt: Date | null;
    sourceName: string | null;
    topicName: string;
  }>,
): string {
  const now = new Date();
  const lines: Array<string | undefined> = [
    "---",
    `title: ${JSON.stringify(question)}`,
    `created: ${now.toISOString()}`,
    "format: wangchao-topic-report",
    `events: ${events.length}`,
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${events.length} 条相关事件生成 · ${now.toISOString()}`,
    "",
    "## 1. 摘要判断",
    "",
    `本报告基于望潮情报库中已抓取并分析的 ${events.length} 条情报事件，围绕"${question}"提供当前态势概览。报告仅基于已有情报，不做推测。`,
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
    if (event.occurredAt) {
      lines.push(`- 时间: ${event.occurredAt.toISOString()}`);
    }
    lines.push(`- 评分: ${Math.round(event.score)}`);
    lines.push("");
  }

  if (events.length > 10) {
    lines.push(`> 还有 ${events.length - 10} 条事件未在此列出。`, "");
  }

  lines.push("## 3. 信息来源与可信度", "");
  const sources = Array.from(
    new Set(events.map((e) => e.sourceName).filter((s): s is string => Boolean(s))),
  );
  for (const source of sources.slice(0, 10)) {
    lines.push(`- ${source}`);
  }
  lines.push("");

  lines.push(
    "## 4. 信息覆盖不足",
    "",
    `本报告仅基于望潮情报库中已有信息，可能存在覆盖不足。情报库中没有的信息不会出现在报告中。`,
    "",
    "## 5. 建议后续关注点",
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
  events: Array<{
    title: string;
    summary: string;
    category: string | null;
    score: number;
    occurredAt: Date | null;
    sourceName: string | null;
    topicName: string;
  }>,
): Promise<string> {
  const systemPrompt = `你是一个专业的情报分析师。基于用户提供的情报事件，围绕用户问题生成一份结构化的中文专题报告。

要求：
1. 只使用提供的事件作为信息来源，不编造信息。
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
4. 关键判断尽量关联具体事件。`;

  const eventsContext = events
    .slice(0, 20)
    .map(
      (e, i) =>
        `[${i + 1}] ${e.title}\n摘要: ${e.summary}\n来源: ${e.sourceName ?? "未知"}\n主题: ${e.topicName}\n时间: ${e.occurredAt?.toISOString() ?? "未知"}\n评分: ${Math.round(e.score)}`,
    )
    .join("\n\n");

  const userPrompt = `问题：${question}\n\n相关情报事件（共 ${events.length} 条）：\n\n${eventsContext}`;

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
    `events: ${events.length}`,
    "ai_generated: true",
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${events.length} 条相关事件由 AI 生成 · ${now.toISOString()}`,
    "",
  ].join("\n");

  return `${header}\n${response.content.trim()}\n`;
}
