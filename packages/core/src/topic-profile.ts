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

export function buildTopicProfile(input: TopicProfileInput): TopicProfileDraft {
  const keywords = extractTopicTerms(`${input.name}\n${input.description ?? ""}`);
  const entities = keywords
    .filter((keyword) => /[A-Z][A-Za-z0-9-]*/.test(keyword) || keyword.length >= 3)
    .slice(0, 8);

  const descriptionSummary = (input.description ?? "").trim().slice(0, 500);

  return {
    entities,
    excludeScope: ["广告软文", "无来源转载", "与主题无关的泛新闻"],
    importanceRules: [
      "优先官方公告、一手博客、研究发布和产品更新。",
      "优先包含明确时间、来源链接、技术细节或影响范围的信息。",
      "降低纯观点、重复转载和缺少来源的信息权重。",
    ],
    includeScope: [
      descriptionSummary || input.name.trim(),
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
    description: topic.description?.trim().slice(0, 500) || null,
    digestStyle: readDigestStyle(record.digestStyle),
    entities: readProfileStringList(record.entities).slice(0, 12),
    excludeScope: readProfileStringList(record.excludeScope).slice(0, 8),
    importanceRules: readProfileStringList(record.importanceRules).slice(0, 6),
    includeScope: readProfileStringList(record.includeScope).slice(0, 8),
    keywords: readProfileStringList(record.keywords).slice(0, 20),
    languagePreferences: readLanguagePreferences(record.languagePreferences),
    name: topic.name.trim().slice(0, 200),
  };
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

export function readProfileRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readProfileStringList(value: unknown): string[] {
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
