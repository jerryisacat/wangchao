import type { DigestStyle } from "./topic-profile.js";
import { DEFAULT_DIGEST_STYLE } from "./topic-profile.js";
import type { MarkdownEventInput } from "./render-event.js";
import { escapeYaml, truncateNarrative } from "./render-event.js";

export interface DailyBriefingInput {
  digestStyle?: DigestStyle;
  events: MarkdownEventInput[];
  generatedAt: Date;
  preferences?: Array<{
    explanation: string;
    key: string;
    weight: number;
  }> ;
  topicName: string;
}

export interface PeriodBriefingInput {
  digestStyle?: DigestStyle;
  events: MarkdownEventInput[];
  generatedAt: Date;
  period: "WEEKLY" | "MONTHLY";
  preferences?: Array<{
    explanation: string;
    key: string;
    weight: number;
  }> ;
  rangeEnd: Date;
  rangeStart: Date;
  topicName: string;
}

// detailLevel 映射到摘要截断长度
const DETAIL_LEVEL_LIMITS: Record<DigestStyle["detailLevel"], number> = {
  brief: 200,
  standard: 800,
  comprehensive: 4000,
};

function truncateForDetailLevel(value: string, detailLevel: DigestStyle["detailLevel"]): string {
  return truncateNarrative(value, DETAIL_LEVEL_LIMITS[detailLevel]);
}

// 中文数字序号
const CN_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function cnIndex(index: number): string {
  const value = CN_NUMS[index];
  return value ?? String(index + 1);
}

// 来源可信度推断
function inferSourceCredibility(score: number, sourceName: string | null | undefined): string {
  if (score >= 80) return "高";
  if (score >= 50) return "中";
  return "低";
}

function renderEventStructured(
  event: MarkdownEventInput,
  index: number,
  detailLevel: DigestStyle["detailLevel"],
): Array<string | undefined> {
  const lines: Array<string | undefined> = [
    `${index + 1}. ${event.title}`,
    "",
    `   - 为什么重要：${truncateForDetailLevel(event.explanation ?? "暂无重要性说明。", detailLevel)}`,
  ];

  // 影响对象（entities）
  const entities = event.entities ?? [];
  if (entities.length > 0) {
    lines.push(`   - 影响对象：${entities.join("、")}`);
  }

  // 来源可信度
  const credibility = inferSourceCredibility(event.score, event.sourceName);
  lines.push(`   - 来源可信度：${credibility}`);

  // 多来源（secondarySources）
  const secondary = event.secondarySources ?? [];
  if (secondary.length > 0) {
    const secondaryLabels = secondary.map((s) => s.sourceName).join("、");
    lines.push(`   - 多来源：${secondaryLabels}`);
  }

  // 后续动作（followUpSuggestion）
  if (event.followUpSuggestion) {
    lines.push(`   - 建议动作：${truncateForDetailLevel(event.followUpSuggestion, detailLevel)}`);
  }

  // 摘要（standard/detailed 展示，compact 不展示）
  lines.push(`   - 摘要：${truncateForDetailLevel(event.summary, detailLevel)}`);

  // 原始链接
  if (event.url) {
    lines.push(`   - 原文链接：${event.url}`);
  }

  lines.push("");
  return lines;
}

function renderEventCompact(
  event: MarkdownEventInput,
  index: number,
  detailLevel: DigestStyle["detailLevel"],
): Array<string | undefined> {
  const lines: Array<string | undefined> = [
    `${index + 1}. **${event.title}** - ${truncateForDetailLevel(event.summary, detailLevel)}`,
  ];
  if (event.url) {
    lines.push(`   - 原文链接：${event.url}`);
  }
  lines.push("");
  return lines;
}

function renderEventDetailed(
  event: MarkdownEventInput,
  index: number,
  detailLevel: DigestStyle["detailLevel"],
): Array<string | undefined> {
  const lines = renderEventStructured(event, index, detailLevel);
  // detailed 结构额外展示评分明细和分类
  const detailExtras: Array<string | undefined> = [
    `   - 评分：${Math.round(event.score)}`,
    `   - 分类：${event.category ?? "通用"}`,
    `   - 来源：${event.sourceName ?? "未知来源"}`,
  ];
  // 在摘要行之前插入评分明细
  const summaryIdx = lines.findIndex((l) => l?.startsWith("   - 摘要"));
  if (summaryIdx >= 0) {
    lines.splice(summaryIdx, 0, ...detailExtras);
  } else {
    lines.push(...detailExtras);
  }
  return lines;
}

export function renderDailyBriefingMarkdown(input: DailyBriefingInput): string {
  const style = input.digestStyle ?? DEFAULT_DIGEST_STYLE;
  const maxEvents = style.maxEvents;
  const topEvents = input.events.slice(0, maxEvents);
  const detailLevel = style.detailLevel;

  const lines: Array<string | undefined> = [
    "---",
    `title: ${escapeYaml(`${input.topicName}｜每日简报`)}`,
    `created: ${input.generatedAt.toISOString()}`,
    `topic: ${escapeYaml(input.topicName)}`,
    "format: wangchao-daily-briefing",
    "structure: " + style.structure,
    "detail_level: " + detailLevel,
    "max_events: " + maxEvents,
    "---",
    "",
    `# ${input.topicName}｜每日情报`,
    "",
    `生成时间：${input.generatedAt.toISOString()}`,
    "",
  ];

  if (topEvents.length === 0) {
    lines.push("今日暂无符合条件的情报事件。", "");
  } else {
    if (style.structure === "compact") {
      lines.push("## 今日事件摘要", "");
      lines.push(
        ...topEvents.flatMap((event, index) =>
          renderEventCompact(event, index, detailLevel),
        ),
      );
    } else {
      lines.push(`## 一、今日最重要进展`, "");
      lines.push(
        ...topEvents.flatMap((event, index) =>
          style.structure === "detailed"
            ? renderEventDetailed(event, index, detailLevel)
            : renderEventStructured(event, index, detailLevel),
        ),
      );
    }
  }

  // 偏好分区（compact 不展示）
  if (style.structure !== "compact") {
    lines.push("## 学习到的偏好", "");
    if (input.preferences && input.preferences.length > 0) {
      lines.push(
        ...input.preferences.slice(0, 8).flatMap((preference) => [
          `- ${preference.key}：${preference.weight >= 0 ? "+" : ""}${preference.weight}`,
          `  - ${preference.explanation}`,
        ]),
      );
    } else {
      lines.push("该主题暂无偏好记忆。");
    }
    lines.push("");
  }

  // 后续动作分区
  if (style.structure === "detailed") {
    lines.push("## 低价值信息过滤", "", "本轮已过滤低价值信息（详见信源质量报告）。", "");
  }

  lines.push("## 后续建议", "", "- [ ] 标记已审阅事件为已读", "- [ ] 将重要单条事件导出到知识库");

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}

export function renderPeriodBriefingMarkdown(input: PeriodBriefingInput): string {
  const style = input.digestStyle ?? DEFAULT_DIGEST_STYLE;
  const maxEvents = Math.max(style.maxEvents, 15);
  const topEvents = input.events.slice(0, maxEvents);
  const detailLevel = style.detailLevel;
  const periodZh = input.period === "WEEKLY" ? "周报" : "月报";
  const rangeFormatter = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
    year: "numeric",
  });

  const lines: Array<string | undefined> = [
    "---",
    `title: ${escapeYaml(`${input.topicName}｜${periodZh}`)}`,
    `created: ${input.generatedAt.toISOString()}`,
    `topic: ${escapeYaml(input.topicName)}`,
    `period: ${input.period}`,
    `range_start: ${input.rangeStart.toISOString()}`,
    `range_end: ${input.rangeEnd.toISOString()}`,
    "format: wangchao-period-briefing",
    "structure: " + style.structure,
    "detail_level: " + detailLevel,
    "max_events: " + maxEvents,
    "---",
    "",
    `# ${input.topicName}｜${periodZh}`,
    "",
    `${rangeFormatter.format(input.rangeStart)} – ${rangeFormatter.format(new Date(input.rangeEnd.getTime() - 1))}`,
    "",
    `生成时间：${input.generatedAt.toISOString()}`,
    "",
  ];

  if (topEvents.length === 0) {
    lines.push("本周期内暂无符合条件的情报事件。", "");
  } else {
    if (style.structure === "compact") {
      lines.push("## 本周期事件摘要", "");
      lines.push(
        ...topEvents.flatMap((event, index) =>
          renderEventCompact(event, index, detailLevel),
        ),
      );
    } else {
      lines.push("## 一、本周期重点事件", "");
      lines.push(
        ...topEvents.flatMap((event, index) =>
          style.structure === "detailed"
            ? renderEventDetailed(event, index, detailLevel)
            : renderEventStructured(event, index, detailLevel),
        ),
      );
    }
  }

  // 偏好分区（compact 不展示）
  if (style.structure !== "compact" && input.preferences && input.preferences.length > 0) {
    lines.push("## 学习到的偏好", "");
    lines.push(
      ...input.preferences.slice(0, 8).flatMap((preference) => [
        `- ${preference.key}：${preference.weight >= 0 ? "+" : ""}${preference.weight}`,
        `  - ${preference.explanation}`,
      ]),
    );
    lines.push("");
  }

  // 后续动作分区
  if (style.structure === "detailed") {
    lines.push("## 低价值信息过滤", "", "本轮已过滤低价值信息（详见信源质量报告）。", "");
  }

  lines.push("## 后续建议", "", "- [ ] 审阅关键事件并归档已处理条目", "- [ ] 将重要事件导出到知识库");

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}
