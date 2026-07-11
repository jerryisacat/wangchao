export * from "./quota.js";

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
  entities: string[];
  eventHash: string;
  explanation: string;
  followUpSuggestion?: string;
  gravityScore: number;
  mergeReason?: string;
  occurredAt: Date;
  score: number;
  summary: string;
  title: string;
  titleHash: string;
}

export interface RelevanceDecision {
  isRelevant: boolean;
  matchedEntities: string[];
  matchedExcludeScopes: string[];
  matchedIncludeScopes: string[];
  matchedKeywords: string[];
  noiseReason?: string;
  score: number;
}

export interface FeedbackSignal {
  category?: string | null;
  kind:
    | "READ"
    | "SAVE"
    | "DISMISS"
    | "EXPORT"
    | "CATEGORY_UP"
    | "CATEGORY_DOWN"
    | "MORE_LIKE_THIS"
    | "LESS_LIKE_THIS"
    | "SOURCE_QUALITY_UP"
    | "SOURCE_QUALITY_DOWN"
    | "SCORE_UP"
    | "SCORE_DOWN";
  sourceId?: string | null;
  sourceName?: string | null;
  topicId: string;
  value?: number | null;
  createdAt?: Date | null;
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

export interface DateRange {
  rangeEnd: Date;
  rangeStart: Date;
}

export interface LanguagePreferences {
  outputLanguage: string;
  terminologyRules: string[];
}

export interface DigestStyle {
  structure: "standard" | "detailed" | "compact";
  detailLevel: "brief" | "standard" | "comprehensive";
  maxEvents: number;
}

export const DEFAULT_LANGUAGE_PREFERENCES: LanguagePreferences = {
  outputLanguage: "zh-CN",
  terminologyRules: [],
};

export const DEFAULT_DIGEST_STYLE: DigestStyle = {
  structure: "standard",
  detailLevel: "standard",
  maxEvents: 10,
};

export interface TopicProfileDraft {
  entities: string[];
  excludeScope: string[];
  importanceRules: string[];
  includeScope: string[];
  keywords: string[];
  languagePreferences: LanguagePreferences;
  digestStyle: DigestStyle;
  source: "topic-profile-generator";
}

export interface TopicProfileContext {
  description: string | null;
  digestStyle: DigestStyle;
  entities: string[];
  excludeScope: string[];
  importanceRules: string[];
  includeScope: string[];
  keywords: string[];
  languagePreferences: LanguagePreferences;
  name: string;
}

export interface TopicProfileInput {
  description?: string | null;
  name: string;
}

export function createUtcDayRange(value: Date): DateRange {
  const rangeStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

  return { rangeEnd, rangeStart };
}

export function createUtcWeekRange(value: Date): DateRange {
  const dayStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const dayOfWeek = dayStart.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const rangeStart = new Date(dayStart);
  rangeStart.setUTCDate(dayStart.getUTCDate() + offsetToMonday);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeStart.getUTCDate() + 7);

  return { rangeEnd, rangeStart };
}

export function createUtcMonthRange(value: Date): DateRange {
  const rangeStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1),
  );
  const rangeEnd = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
  );

  return { rangeEnd, rangeStart };
}

export function buildTopicProfile(input: TopicProfileInput): TopicProfileDraft {
  const keywords = extractTopicTerms(`${input.name}\n${input.description ?? ""}`);
  const entities = keywords
    .filter((keyword) => /[A-Z][A-Za-z0-9-]*/.test(keyword) || keyword.length >= 3)
    .slice(0, 8);

  return {
    entities,
    excludeScope: ["广告软文", "无来源转载", "与主题无关的泛新闻"],
    importanceRules: [
      "优先官方公告、一手博客、研究发布和产品更新。",
      "优先包含明确时间、来源链接、技术细节或影响范围的信息。",
      "降低纯观点、重复转载和缺少来源的信息权重。",
    ],
    includeScope: [
      input.description?.trim() || input.name.trim(),
      "公开 RSS/Atom、官方博客、研究团队和工程团队更新。",
    ],
    keywords,
    languagePreferences: { ...DEFAULT_LANGUAGE_PREFERENCES },
    digestStyle: { ...DEFAULT_DIGEST_STYLE },
    source: "topic-profile-generator",
  };
}

export function buildTopicProfileContext(
  profile: unknown,
  topic: { description?: string | null; name: string },
): TopicProfileContext {
  const record = readProfileRecord(profile);

  return {
    description: topic.description?.trim() || null,
    digestStyle: readDigestStyle(record.digestStyle),
    entities: readProfileStringList(record.entities),
    excludeScope: readProfileStringList(record.excludeScope),
    importanceRules: readProfileStringList(record.importanceRules),
    includeScope: readProfileStringList(record.includeScope),
    keywords: readProfileStringList(record.keywords),
    languagePreferences: readLanguagePreferences(record.languagePreferences),
    name: topic.name.trim(),
  };
}

export function evaluateRelevance(item: IntelligenceInputItem): RelevanceDecision {
  const profile = readProfileRecord(item.topicProfile);
  const keywords = readProfileStringList(profile.keywords);
  const entities = readProfileStringList(profile.entities);
  const includeScopes = readProfileStringList(profile.includeScope);
  const excludeScopes = readProfileStringList(profile.excludeScope);
  const haystack = `${item.title}\n${item.summary ?? ""}`.toLowerCase();
  const matches = (values: string[]) =>
    values.filter((value) => haystack.includes(value.toLowerCase()));
  const matchedKeywords = matches(keywords);
  const matchedEntities = matches(entities);
  const matchedIncludeScopes = matches(includeScopes);
  const matchedExcludeScopes = matches(excludeScopes);

  if (matchedExcludeScopes.length > 0) {
    return {
      isRelevant: false,
      matchedEntities,
      matchedExcludeScopes,
      matchedIncludeScopes,
      matchedKeywords,
      noiseReason: `Matched excluded topic scope: ${matchedExcludeScopes.join(", ")}.`,
      score: 0,
    };
  }

  const hasPositiveSignal =
    matchedKeywords.length > 0 ||
    matchedEntities.length > 0 ||
    matchedIncludeScopes.length > 0;
  const score = Math.min(
    98,
    (hasPositiveSignal ? 72 : 42) +
      matchedKeywords.length * 8 +
      matchedEntities.length * 6 +
      matchedIncludeScopes.length * 6,
  );

  return {
    isRelevant: score >= 70,
    matchedEntities,
    matchedExcludeScopes,
    matchedIncludeScopes,
    matchedKeywords,
    noiseReason: score >= 70 ? undefined : "No positive topic profile signals matched.",
    score,
  };
}

const RSS_METADATA_PATTERN = /Article URL:|Comments URL:|Points:|#\s*Comments:/i;

export function buildRuleFallbackSummary(
  rawSummary: string | null | undefined,
  title: string,
): string {
  if (rawSummary && rawSummary.trim()) {
    if (!RSS_METADATA_PATTERN.test(rawSummary)) {
      return rawSummary.trim();
    }
    const cleaned = rawSummary
      .replace(/Article URL:\s*[^\n<]+/gi, " ")
      .replace(/Comments URL:\s*[^\n<]+/gi, " ")
      .replace(/Points:\s*[^\n<]+/gi, " ")
      .replace(/#\s*Comments:\s*[^\n<]+/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return title.trim() || "待 AI 生成摘要。";
}

export function createIntelligenceEventDraft(
  item: IntelligenceInputItem,
  decision = evaluateRelevance(item),
): IntelligenceEventDraft | null {
  if (!decision.isRelevant) {
    return null;
  }

  const occurredAt = item.publishedAt ?? item.fetchedAt;
  const summary = buildRuleFallbackSummary(item.summary, item.title);
  const category = decision.matchedKeywords[0]
    ? `keyword:${decision.matchedKeywords[0]}`
    : decision.matchedEntities[0]
      ? `entity:${decision.matchedEntities[0]}`
      : decision.matchedIncludeScopes[0]
        ? `scope:${decision.matchedIncludeScopes[0]}`
        : "general";
  const eventHash = createEventHash(`${normalizeTitle(item.title)}\n${item.url}`);
  const titleHash = createTitleHash(item.title);
  const gravityScore = calculateGravityScore(decision.score, occurredAt, new Date());

  return {
    category,
    entities: decision.matchedEntities,
    eventHash,
    explanation: buildRelevanceExplanation(decision),
    followUpSuggestion: undefined,
    gravityScore,
    mergeReason: undefined,
    occurredAt,
    score: decision.score,
    summary,
    title: item.title.trim(),
    titleHash,
  };
}

function buildRelevanceExplanation(decision: RelevanceDecision): string {
  const signals = [
    decision.matchedKeywords.length > 0
      ? `Matched topic keywords: ${decision.matchedKeywords.join(", ")}.`
      : null,
    decision.matchedEntities.length > 0
      ? `Matched topic entities: ${decision.matchedEntities.join(", ")}.`
      : null,
    decision.matchedIncludeScopes.length > 0
      ? `Matched include scope: ${decision.matchedIncludeScopes.join(", ")}.`
      : null,
  ].filter((signal): signal is string => signal !== null);

  return signals.join(" ") || "Matched default relevance threshold.";
}

export interface AiEventExtraction {
  category: string;
  entities: string[];
  followUpSuggestion: string;
  importanceExplanation: string;
  isRelevant: boolean;
  matchedKeywords: string[];
  noiseReason?: string;
  relevanceScore: number;
  summary: string;
  title: string;
}

export function createIntelligenceEventDraftFromExtraction(
  item: IntelligenceInputItem,
  extraction: AiEventExtraction,
): IntelligenceEventDraft | null {
  if (!extraction.isRelevant) {
    return null;
  }

  const occurredAt = item.publishedAt ?? item.fetchedAt;
  const eventHash = createEventHash(
    `${normalizeTitle(extraction.title)}\n${item.url}`,
  );
  const titleHash = createTitleHash(extraction.title);
  const gravityScore = calculateGravityScore(
    extraction.relevanceScore,
    occurredAt,
    new Date(),
  );

  return {
    category: extraction.category || "general",
    entities: extraction.entities ?? [],
    eventHash,
    explanation: extraction.importanceExplanation || "未提供评分原因。",
    followUpSuggestion: extraction.followUpSuggestion || undefined,
    gravityScore,
    mergeReason: undefined,
    occurredAt,
    score: extraction.relevanceScore,
    summary: extraction.summary,
    title: extraction.title,
    titleHash,
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
  now: Date = new Date(),
): PreferenceDelta[] {
  const grouped = new Map<
    string,
    {
      score: number;
      signalCount: number;
      topicId: string;
      type: "category" | "source";
      latestSignalAt: Date;
    }
  >();

  for (const signal of signals) {
    const weight = feedbackSignalWeight(signal);
    const keys = preferenceKeysForSignal(signal);

    for (const key of keys) {
      const groupKey = `${signal.topicId}\u0000${key}`;
      const signalTime = signal.createdAt ?? now;
      const decayedWeight = applyTimeDecay(weight, signalTime, now);
      const existing = grouped.get(groupKey) ?? {
        score: 0,
        signalCount: 0,
        topicId: signal.topicId,
        type: key.startsWith("source") ? ("source" as const) : ("category" as const),
        latestSignalAt: signalTime,
      };
      existing.score += decayedWeight;
      existing.signalCount += 1;
      if (signalTime > existing.latestSignalAt) {
        existing.latestSignalAt = signalTime;
      }
      grouped.set(groupKey, existing);
    }
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => Math.abs(group.score) >= 1)
    .map(([groupKey, group]) => {
      const key = groupKey.slice(groupKey.indexOf("\u0000") + 1);
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

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
        `${index + 1}. **${event.title}** — ${event.summary}`,
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
          ? event.secondarySources.map(
              (s) => `- Also reported by: ${s.sourceName}`,
            )
          : []),
        event.url ? `- Original: ${event.url}` : undefined,
        event.explanation ? `- Why it matters: ${event.explanation}` : undefined,
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
          `${index + 1}. **${event.title}** — ${event.summary}`,
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

export function createContentHash(value: string): string {
  return createEventHash(value).replace("event:", "content:");
}

export function extractKeywords(topicProfile: unknown): string[] {
  return readProfileStringList(readProfileRecord(topicProfile).keywords);
}

function extractTopicTerms(value: string): string[] {
  const terms = value
    .split(/[\s,，、;；:：/|()\[\]{}"'“”‘’<>《》.!?！？\n\r\t]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !TOPIC_STOP_WORDS.has(term.toLowerCase()));
  const cjkPhrases = [
    ...value.matchAll(/[\u4e00-\u9fff]{2,8}/g),
  ].map((match) => match[0]);

  return Array.from(new Set([...terms, ...cjkPhrases])).slice(0, 16);
}

const TOPIC_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "关注",
  "跟踪",
  "观察",
  "相关",
]);

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
  if (signal.kind === "CATEGORY_UP" || signal.kind === "CATEGORY_DOWN") {
    return signal.category ? [`category:${signal.category}`] : [];
  }

  if (signal.kind === "MORE_LIKE_THIS" || signal.kind === "LESS_LIKE_THIS") {
    const keys: string[] = [];
    if (signal.category) {
      keys.push(`category:${signal.category}`);
    }
    keys.push(...preferenceKeysForEvent({
      category: signal.category,
      sourceId: signal.sourceId,
      sourceName: signal.sourceName,
    }));
    return keys;
  }

  if (signal.kind === "SOURCE_QUALITY_UP" || signal.kind === "SOURCE_QUALITY_DOWN") {
    return preferenceKeysForEvent({
      category: null,
      sourceId: signal.sourceId,
      sourceName: signal.sourceName,
    });
  }

  if (signal.kind === "SCORE_UP" || signal.kind === "SCORE_DOWN") {
    return signal.category ? [`category:${signal.category}`] : [];
  }

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

  if (signal.kind === "CATEGORY_UP" || signal.kind === "MORE_LIKE_THIS") {
    return 2;
  }

  if (signal.kind === "SOURCE_QUALITY_UP") {
    return 1.5;
  }

  if (signal.kind === "SCORE_UP") {
    return 1;
  }

  if (signal.kind === "SOURCE_QUALITY_DOWN") {
    return -1.5;
  }

  if (signal.kind === "SCORE_DOWN") {
    return -1;
  }

  if (signal.kind === "READ") {
    return 0.5;
  }

  return -2;
}

const PREFERENCE_DECAY_HALF_LIFE_DAYS = 30;

function applyTimeDecay(
  weight: number,
  signalTime: Date,
  now: Date,
): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - signalTime.getTime()) / (1000 * 60 * 60 * 24),
  );
  const decayFactor = Math.pow(0.5, ageDays / PREFERENCE_DECAY_HALF_LIFE_DAYS);
  return Number((weight * decayFactor).toFixed(4));
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

function readProfileRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readProfileStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= 160)
        .slice(0, 50),
    ),
  );
}

function readLanguagePreferences(value: unknown): LanguagePreferences {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      outputLanguage:
        typeof record.outputLanguage === "string" &&
        record.outputLanguage.trim().length > 0
          ? record.outputLanguage.trim().slice(0, 20)
          : DEFAULT_LANGUAGE_PREFERENCES.outputLanguage,
      terminologyRules: readProfileStringList(record.terminologyRules),
    };
  }
  return { ...DEFAULT_LANGUAGE_PREFERENCES };
}

function readDigestStyle(value: unknown): DigestStyle {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const structure = record.structure;
    const detailLevel = record.detailLevel;
    const maxEvents = Number(record.maxEvents);
    return {
      structure:
        typeof structure === "string" &&
        ["standard", "detailed", "compact"].includes(structure)
          ? (structure as DigestStyle["structure"])
          : DEFAULT_DIGEST_STYLE.structure,
      detailLevel:
        typeof detailLevel === "string" &&
        ["brief", "standard", "comprehensive"].includes(detailLevel)
          ? (detailLevel as DigestStyle["detailLevel"])
          : DEFAULT_DIGEST_STYLE.detailLevel,
      maxEvents:
        Number.isFinite(maxEvents) && maxEvents >= 1 && maxEvents <= 50
          ? maxEvents
          : DEFAULT_DIGEST_STYLE.maxEvents,
    };
  }
  return { ...DEFAULT_DIGEST_STYLE };
}

function normalizeTitleForFuzzyMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[「」【】｜\|\-:：].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createTitleHash(title: string): string {
  return `title:${createEventHash(normalizeTitleForFuzzyMatch(title)).replace("event:", "")}`;
}

function createEventHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `event:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
