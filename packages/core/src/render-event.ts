import { isHttpUrl } from "./text.js";

export interface MarkdownEventInput {
  category?: string | null;
  entities?: string[];
  explanation?: string | null;
  followUpSuggestion?: string;
  occurredAt?: Date | null;
  score: number;
  sourceName?: string | null;
  sourceUrl?: string | null;
  summary: string;
  title: string;
  url?: string | null;
  secondarySources?: Array<{
    sourceName: string;
    url: string | null;
  }>;
}

const MAX_NARRATIVE_LENGTH = 4000;

export function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

export function truncateNarrative(value: string, maxLength = MAX_NARRATIVE_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n…（内容已截断）`;
}

export function renderEventMarkdown(
  event: MarkdownEventInput,
  generatedAt = new Date(),
): string {
  const sourceFeedUrl = event.sourceUrl && isHttpUrl(event.sourceUrl)
    ? event.sourceUrl
    : undefined;
  const originalUrl = event.url && isHttpUrl(event.url) ? event.url : undefined;
  const lines = [
    "---",
    `title: ${escapeYaml(event.title)}`,
    `created: ${generatedAt.toISOString()}`,
    `source: ${escapeYaml(event.sourceName ?? "Unknown source")}`,
    "---",
    "",
    `# ${event.title}`,
    "",
    `> Generated at ${generatedAt.toISOString()}`,
    "",
    "## Summary",
    "",
    truncateNarrative(event.summary),
    "",
    "## Why It Matters",
    "",
    truncateNarrative(event.explanation || "No explanation was generated for this event yet."),
    "",
    "## Metadata",
    "",
    `- Score: ${Math.round(event.score)}`,
    `- Category: ${event.category ?? "general"}`,
    `- Occurred at: ${(event.occurredAt ?? generatedAt).toISOString()}`,
    `- Source: ${event.sourceName ?? "Unknown source"}`,
    sourceFeedUrl ? `- Source feed: ${sourceFeedUrl}` : undefined,
    originalUrl ? `- Original: ${originalUrl}` : undefined,
    event.entities && event.entities.length > 0
      ? `- Entities: ${event.entities.join(", ")}`
      : undefined,
    "",
    "## Follow Up",
    "",
    event.followUpSuggestion || "- [ ] Review source context\n- [ ] Decide whether to keep tracking this thread",
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}
