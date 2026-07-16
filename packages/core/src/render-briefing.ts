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
  }>;
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
  }>;
  rangeEnd: Date;
  rangeStart: Date;
  topicName: string;
}

export function renderDailyBriefingMarkdown(input: DailyBriefingInput): string {
  const style = input.digestStyle ?? DEFAULT_DIGEST_STYLE;
  const maxEvents = style.maxEvents;
  const topEvents = input.events.slice(0, maxEvents);

  const lines: Array<string | undefined> = [
    "---",
    `title: ${escapeYaml(`${input.topicName} Daily Briefing`)}`,
    `created: ${input.generatedAt.toISOString()}`,
    `topic: ${escapeYaml(input.topicName)}`,
    "format: wangchao-daily-briefing",
    "---",
    "",
    `# ${input.topicName} Daily Briefing`,
    "",
    `Generated at ${input.generatedAt.toISOString()}.`,
    "",
  ];

  if (style.structure !== "compact") {
    lines.push(
      "## Executive Summary",
      "",
      topEvents.length > 0
        ? `Today's briefing contains ${topEvents.length} ranked intelligence events.`
        : "No ranked intelligence events were available for this briefing.",
      "",
    );
  }

  lines.push("## Top Events", "");

  if (style.structure === "compact") {
    lines.push(
      ...topEvents.flatMap((event, index) => [
        `${index + 1}. **${event.title}** - ${truncateNarrative(event.summary, 500)}`,
        event.url ? `   - Original: ${event.url}` : undefined,
        "",
      ]),
    );
  } else {
    lines.push(
      ...topEvents.flatMap((event, index) => [
        `### ${index + 1}. ${event.title}`,
        "",
        truncateNarrative(event.summary),
        "",
        `- Score: ${Math.round(event.score)}`,
        `- Category: ${event.category ?? "general"}`,
        `- Source: ${event.sourceName ?? "Unknown source"}`,
        ...(event.secondarySources && event.secondarySources.length > 0
          ? event.secondarySources.map(
              (s) => `- Also reported by: ${s.sourceName}`,
            )
          : []),
        event.url ? `- Original: ${event.url}` : undefined,
        event.explanation ? `- Why it matters: ${truncateNarrative(event.explanation, 500)}` : undefined,
        "",
      ]),
    );
  }

  if (style.structure !== "compact") {
    lines.push(
      "## Learned Preferences",
      "",
      ...(input.preferences && input.preferences.length > 0
        ? input.preferences.slice(0, 8).flatMap((preference) => [
            `- ${preference.key}: ${preference.weight >= 0 ? "+" : ""}${preference.weight}`,
            `  - ${preference.explanation}`,
          ])
        : ["No preference memory was available for this topic yet."]),
      "",
    );
  }

  lines.push("## Follow Up", "", "- [ ] Mark reviewed events as read", "- [ ] Export important single events into the knowledge base");

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}

export function renderPeriodBriefingMarkdown(input: PeriodBriefingInput): string {
  const style = input.digestStyle ?? DEFAULT_DIGEST_STYLE;
  const maxEvents = Math.max(style.maxEvents, 15);
  const topEvents = input.events.slice(0, maxEvents);
  const periodLabel = input.period === "WEEKLY" ? "Weekly" : "Monthly";
  const periodZh = input.period === "WEEKLY" ? "周报" : "月报";
  const rangeFormatter = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
    year: "numeric",
  });

  const lines: Array<string | undefined> = [
    "---",
    `title: ${escapeYaml(`${input.topicName} ${periodLabel} Briefing`)}`,
    `created: ${input.generatedAt.toISOString()}`,
    `topic: ${escapeYaml(input.topicName)}`,
    `period: ${input.period}`,
    `range_start: ${input.rangeStart.toISOString()}`,
    `range_end: ${input.rangeEnd.toISOString()}`,
    "format: wangchao-period-briefing",
    "---",
    "",
    `# ${input.topicName} ${periodZh}`,
    "",
    `${rangeFormatter.format(input.rangeStart)} – ${rangeFormatter.format(new Date(input.rangeEnd.getTime() - 1))}`,
    "",
    `Generated at ${input.generatedAt.toISOString()}.`,
    "",
  ];

  if (topEvents.length === 0) {
    lines.push("本周期内没有符合条件的情报事件。", "");
  } else {
    lines.push("## 本周期重点事件", "");

    if (style.structure === "compact") {
      lines.push(
        ...topEvents.flatMap((event, index) => [
          `${index + 1}. **${event.title}** - ${event.summary}`,
          event.url ? `   - Original: ${event.url}` : undefined,
          "",
        ]),
      );
    } else {
      lines.push(
        ...topEvents.flatMap((event, index) => [
          `### ${index + 1}. ${event.title}`,
          "",
          event.summary,
          "",
          `- Score: ${Math.round(event.score)}`,
          `- Category: ${event.category ?? "general"}`,
          `- Source: ${event.sourceName ?? "Unknown source"}`,
          ...(event.secondarySources && event.secondarySources.length > 0
            ? event.secondarySources.map((s) => `- Also reported by: ${s.sourceName}`)
            : []),
          event.url ? `- Original: ${event.url}` : undefined,
          event.explanation ? `- Why it matters: ${event.explanation}` : undefined,
          "",
        ]),
      );
    }
  }

  if (style.structure !== "compact" && input.preferences && input.preferences.length > 0) {
    lines.push(
      "## Learned Preferences",
      "",
      ...input.preferences.slice(0, 8).flatMap((preference) => [
        `- ${preference.key}: ${preference.weight >= 0 ? "+" : ""}${preference.weight}`,
        `  - ${preference.explanation}`,
      ]),
      "",
    );
  }

  lines.push("## Follow Up", "", "- [ ] Review key events and archive processed items", "- [ ] Export important events into the knowledge base");

  return `${lines.filter((line): line is string => line !== undefined).join("\n")}\n`;
}
