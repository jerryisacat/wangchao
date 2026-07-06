export interface IntelligenceInputItem {
  id: string;
  title: string;
  summary?: string | null;
  url: string;
  publishedAt?: Date | null;
  fetchedAt: Date;
  topicProfile?: unknown;
}

export interface IntelligenceEventDraft {
  category: string;
  eventHash: string;
  explanation: string;
  gravityScore: number;
  occurredAt: Date;
  score: number;
  summary: string;
  title: string;
}

export interface RelevanceDecision {
  isRelevant: boolean;
  matchedKeywords: string[];
  noiseReason?: string;
  score: number;
}

export interface FeedbackSignal {
  category?: string | null;
  kind: "READ" | "SAVE" | "DISMISS" | "EXPORT";
  sourceId?: string | null;
  sourceName?: string | null;
  topicId: string;
  value?: number | null;
}

export interface PreferenceDelta {
  confidence: number;
  explanation: string;
  key: string;
  topicId: string;
  value: {
    signalCount: number;
    weight: number;
  };
}

export interface PreferenceWeight {
  key: string;
  weight: number;
}

export interface MarkdownEventInput {
  category?: string | null;
  explanation?: string | null;
  occurredAt?: Date | null;
  score: number;
  sourceName?: string | null;
  sourceUrl?: string | null;
  summary: string;
  title: string;
  url?: string | null;
}

export interface DailyBriefingInput {
  events: MarkdownEventInput[];
  generatedAt: Date;
  preferences?: Array<{
    explanation: string;
    key: string;
    weight: number;
  }>;
  topicName: string;
}

export function evaluateRelevance(item: IntelligenceInputItem): RelevanceDecision {
  const keywords = extractKeywords(item.topicProfile);
  const haystack = `${item.title}\n${item.summary ?? ""}`.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
  const baseScore = matchedKeywords.length > 0 ? 72 : 42;
  const score = Math.min(98, baseScore + matchedKeywords.length * 8);

  return {
    isRelevant: score >= 70,
    matchedKeywords,
    noiseReason: score >= 70 ? undefined : "No topic keywords matched.",
    score,
  };
}

export function createIntelligenceEventDraft(
  item: IntelligenceInputItem,
  decision = evaluateRelevance(item),
): IntelligenceEventDraft | null {
  if (!decision.isRelevant) {
    return null;
  }

  const occurredAt = item.publishedAt ?? item.fetchedAt;
  const summary = item.summary?.trim() || item.title;
  const category =
    decision.matchedKeywords[0] !== undefined
      ? `keyword:${decision.matchedKeywords[0]}`
      : "general";
  const eventHash = createEventHash(`${normalizeTitle(item.title)}\n${item.url}`);
  const gravityScore = calculateGravityScore(decision.score, occurredAt, new Date());

  return {
    category,
    eventHash,
    explanation:
      decision.matchedKeywords.length > 0
        ? `Matched topic keywords: ${decision.matchedKeywords.join(", ")}.`
        : "Matched default relevance threshold.",
    gravityScore,
    occurredAt,
    score: decision.score,
    summary,
    title: item.title.trim(),
  };
}

export function calculateGravityScore(
  baseScore: number,
  occurredAt: Date,
  now: Date,
): number {
  const ageHours = Math.max(
    0,
    (now.getTime() - occurredAt.getTime()) / (1000 * 60 * 60),
  );
  const offset = 6;
  const effectiveGravity = baseScore >= 90 ? 0.9 : 1.15;
  return Number(
    (baseScore * (offset / (ageHours + offset)) ** effectiveGravity).toFixed(4),
  );
}

export function generatePreferenceDeltas(
  signals: FeedbackSignal[],
): PreferenceDelta[] {
  const grouped = new Map<
    string,
    {
      score: number;
      signalCount: number;
      topicId: string;
      type: "category" | "source";
    }
  >();

  for (const signal of signals) {
    const weight = feedbackSignalWeight(signal);
    const keys = preferenceKeysForSignal(signal);

    for (const key of keys) {
      const existing = grouped.get(key) ?? {
        score: 0,
        signalCount: 0,
        topicId: signal.topicId,
        type: key.startsWith("source") ? ("source" as const) : ("category" as const),
      };
      existing.score += weight;
      existing.signalCount += 1;
      grouped.set(key, existing);
    }
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => Math.abs(group.score) >= 1)
    .map(([key, group]) => {
      const normalizedWeight = Number(
        Math.max(-4, Math.min(4, group.score)).toFixed(2),
      );

      return {
        confidence: Number(
          Math.min(0.95, 0.35 + group.signalCount * 0.12).toFixed(2),
        ),
        explanation: buildPreferenceExplanation(
          group.type,
          key,
          normalizedWeight,
          group.signalCount,
        ),
        key,
        topicId: group.topicId,
        value: {
          signalCount: group.signalCount,
          weight: normalizedWeight,
        },
      };
    })
    .sort((left, right) => Math.abs(right.value.weight) - Math.abs(left.value.weight));
}

export function applyPreferenceWeights(
  baseGravityScore: number,
  keys: string[],
  weights: PreferenceWeight[],
): number {
  const totalWeight = weights
    .filter((weight) => keys.includes(weight.key))
    .reduce((sum, weight) => sum + weight.weight, 0);
  const multiplier = Math.max(0.4, Math.min(1.6, 1 + totalWeight * 0.08));

  return Number((baseGravityScore * multiplier).toFixed(4));
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
    event.summary,
    "",
    "## Why It Matters",
    "",
    event.explanation || "No explanation was generated for this event yet.",
    "",
    "## Metadata",
    "",
    `- Score: ${Math.round(event.score)}`,
    `- Category: ${event.category ?? "general"}`,
    `- Occurred at: ${(event.occurredAt ?? generatedAt).toISOString()}`,
    `- Source: ${event.sourceName ?? "Unknown source"}`,
    sourceFeedUrl ? `- Source feed: ${sourceFeedUrl}` : undefined,
    originalUrl ? `- Original: ${originalUrl}` : undefined,
    "",
    "## Follow Up",
    "",
    "- [ ] Review source context",
    "- [ ] Decide whether to keep tracking this thread",
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function renderDailyBriefingMarkdown(input: DailyBriefingInput): string {
  const topEvents = input.events.slice(0, 10);
  const lines = [
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
    "## Executive Summary",
    "",
    topEvents.length > 0
      ? `Today's briefing contains ${topEvents.length} ranked intelligence events.`
      : "No ranked intelligence events were available for this briefing.",
    "",
    "## Top Events",
    "",
    ...topEvents.flatMap((event, index) => [
      `### ${index + 1}. ${event.title}`,
      "",
      event.summary,
      "",
      `- Score: ${Math.round(event.score)}`,
      `- Category: ${event.category ?? "general"}`,
      `- Source: ${event.sourceName ?? "Unknown source"}`,
      event.url ? `- Original: ${event.url}` : undefined,
      event.explanation ? `- Why it matters: ${event.explanation}` : undefined,
      "",
    ]),
    "## Learned Preferences",
    "",
    ...(input.preferences && input.preferences.length > 0
      ? input.preferences.slice(0, 8).flatMap((preference) => [
          `- ${preference.key}: ${preference.weight >= 0 ? "+" : ""}${preference.weight}`,
          `  - ${preference.explanation}`,
        ])
      : ["No preference memory was available for this topic yet."]),
    "",
    "## Follow Up",
    "",
    "- [ ] Mark reviewed events as read",
    "- [ ] Export important single events into the knowledge base",
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}

export function createContentHash(value: string): string {
  return createEventHash(value).replace("event:", "content:");
}

export function extractKeywords(topicProfile: unknown): string[] {
  if (!topicProfile || typeof topicProfile !== "object") {
    return [];
  }

  const keywords = (topicProfile as { keywords?: unknown }).keywords;
  if (!Array.isArray(keywords)) {
    return [];
  }

  return keywords
    .filter((keyword): keyword is string => typeof keyword === "string")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function preferenceKeysForEvent(input: {
  category?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
}): string[] {
  const keys: string[] = [];

  if (input.category) {
    keys.push(`category:${input.category}`);
  }

  if (input.sourceId) {
    keys.push(`source:${input.sourceId}`);
  } else if (input.sourceName) {
    keys.push(`source-name:${normalizeTitle(input.sourceName)}`);
  }

  return keys;
}

function preferenceKeysForSignal(signal: FeedbackSignal): string[] {
  return preferenceKeysForEvent({
    category: signal.category,
    sourceId: signal.sourceId,
    sourceName: signal.sourceName,
  });
}

function feedbackSignalWeight(signal: FeedbackSignal): number {
  if (typeof signal.value === "number") {
    return signal.value;
  }

  if (signal.kind === "SAVE" || signal.kind === "EXPORT") {
    return 2;
  }

  if (signal.kind === "READ") {
    return 0.5;
  }

  return -2;
}

function buildPreferenceExplanation(
  type: "category" | "source",
  key: string,
  weight: number,
  signalCount: number,
): string {
  const direction = weight >= 0 ? "increased" : "decreased";
  const target = type === "category" ? "category" : "source";

  return `${signalCount} feedback signals ${direction} the ${target} preference for ${key}.`;
}

function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function createEventHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `event:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
