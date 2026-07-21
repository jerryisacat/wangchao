import { parseJsonObject, validateJsonObject } from "./parser.js";
import type { AiChatMessage, JsonSchema } from "./types.js";

/**
 * Versioned contract for a topic profile draft produced from natural-language
 * input. Stored only in the user session until the user confirms creation; the
 * confirmed shape is what gets persisted onto `Topic.profile`.
 *
 * `schemaVersion` is a breaking-change guard: the worker reads profile JSON via
 * `buildTopicProfileContext` which already sanitizes arbitrary shapes, but the
 * draft generator pins the version so any future incompatible change is forced
 * through an explicit bump rather than a silent drift.
 */
export const TOPIC_PROFILE_DRAFT_SCHEMA_VERSION = 1;

export interface TopicProfileDraftInput {
  description?: string | null;
  name: string;
}

export interface TopicProfileDigestStyle {
  structure: "standard" | "detailed" | "compact";
  detailLevel: "brief" | "standard" | "comprehensive";
  maxEvents: number;
}

export interface TopicProfileLanguagePreferences {
  outputLanguage: string;
  terminologyRules: string[];
}

export interface TopicProfileDraft {
  schemaVersion: typeof TOPIC_PROFILE_DRAFT_SCHEMA_VERSION;
  source: "topic-profile-generator";
  /**
   * "ai" when an LLM produced the draft; "rules" when the deterministic
   * fallback was used (no AI configured, AI quota exhausted, or upstream
   * failure). The UI must surface this so users know whether they are
   * reviewing model output or a heuristic baseline.
   */
  generationMode: "ai" | "rules";
  name: string;
  keywords: string[];
  entities: string[];
  includeScope: string[];
  excludeScope: string[];
  importanceRules: string[];
  languagePreferences: TopicProfileLanguagePreferences;
  digestStyle: TopicProfileDigestStyle;
  raw?: Record<string, unknown>;
}

export interface TopicProfileDraftAdapter {
  chat(request: {
    jsonMode?: boolean;
    maxTokens?: number;
    messages: AiChatMessage[];
    model: string;
    temperature?: number;
  }): Promise<{ content: string; raw?: unknown }>;
}

const TOPIC_PROFILE_DRAFT_SCHEMA: JsonSchema = {
  required: [
    "schemaVersion",
    "name",
    "keywords",
    "entities",
    "includeScope",
    "excludeScope",
    "importanceRules",
    "languagePreferences",
    "digestStyle",
  ],
  properties: {
    schemaVersion: { type: "number" },
    name: { type: "string" },
    keywords: { type: "array" },
    entities: { type: "array" },
    includeScope: { type: "array" },
    excludeScope: { type: "array" },
    importanceRules: { type: "array" },
    languagePreferences: { type: "object" },
    digestStyle: { type: "object" },
  },
};

const DEFAULT_DIGEST_STYLE: TopicProfileDigestStyle = {
  structure: "standard",
  detailLevel: "standard",
  maxEvents: 10,
};

const DEFAULT_OUTPUT_LANGUAGE = "zh-CN";

export function buildTopicProfileDraftMessages(
  input: TopicProfileDraftInput,
): AiChatMessage[] {
  const safeName = sanitizeShortText(input.name, 120);
  const safeDescription = sanitizeLongText(input.description ?? "", 2_000);

  return [
    {
      role: "system",
      content:
        "You draft a topic profile for a topic-driven intelligence workspace from a short natural-language goal. Return strict JSON only. The user-facing fields must be written in Simplified Chinese (zh-CN); preserve English proper nouns and acronyms (C919, OpenAI, COMAC, etc.). Extract concrete entities (companies, products, people, regulators, regions), propose include/exclude scope that a relevance filter can match against titles and summaries, and write 3-5 short importance rules an AI scorer can use. Never invent facts beyond the user's goal; when uncertain, prefer a broader but accurate scope over specific fabricated entities. Always return every schema field.",
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction:
          "根据下面的自然语言主题目标，生成结构化主题画像草案。所有用户可见字段使用简体中文，保留英文专有名词。keywords 用于信源发现与相关性筛选；entities 是公司/机构/人物/产品/政策/地区；includeScope / excludeScope 是短语，用于在标题与摘要上做大小写不敏感匹配；importanceRules 是给 AI 评分用的短句。",
        outputSchema: {
          schemaVersion: "number, must be 1",
          name: "string, cleaned topic name in Simplified Chinese",
          keywords:
            "array of short Simplified Chinese / English keywords for source discovery and relevance. Max 20 items.",
          entities: "array of entity names. Max 12 items.",
          includeScope: "array of short Simplified Chinese phrases. Max 8 items.",
          excludeScope: "array of short Simplified Chinese phrases. Max 8 items.",
          importanceRules: "array of short Simplified Chinese sentences. Max 6 items.",
          languagePreferences: {
            outputLanguage: "string, must be zh-CN",
            terminologyRules: "array of short terminology rules. Max 10 items.",
          },
          digestStyle: {
            structure: "one of standard | detailed | compact",
            detailLevel: "one of brief | standard | comprehensive",
            maxEvents: "number between 1 and 50",
          },
        },
        topic: {
          name: safeName,
          description: safeDescription,
        },
      }),
    },
  ];
}

export function parseTopicProfileDraftResponse(
  content: string,
): TopicProfileDraft {
  const parsed = parseJsonObject(content);
  const validation = validateJsonObject(parsed, TOPIC_PROFILE_DRAFT_SCHEMA);

  if (!validation.ok) {
    throw new Error(
      `Invalid topic profile draft JSON: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const rawVersion = Number(parsed.schemaVersion);
  if (!Number.isFinite(rawVersion) || rawVersion !== TOPIC_PROFILE_DRAFT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported topic profile draft schemaVersion: ${String(parsed.schemaVersion)}`,
    );
  }

  const name = sanitizeShortText(parsed.name, 120);
  if (!name) {
    throw new Error("Topic profile draft name is empty.");
  }

  const keywords = sanitizeStringList(parsed.keywords, 20, 200);
  const entities = sanitizeStringList(parsed.entities, 12, 120);
  const includeScope = sanitizeStringList(parsed.includeScope, 8, 200);
  const excludeScope = sanitizeStringList(parsed.excludeScope, 8, 200);
  const importanceRules = sanitizeStringList(parsed.importanceRules, 6, 240);

  if (keywords.length === 0) {
    throw new Error("Topic profile draft must carry at least one keyword.");
  }

  return {
    schemaVersion: TOPIC_PROFILE_DRAFT_SCHEMA_VERSION,
    source: "topic-profile-generator",
    generationMode: "ai",
    name,
    keywords,
    entities,
    includeScope,
    excludeScope,
    importanceRules,
    languagePreferences: readLanguagePreferences(parsed.languagePreferences),
    digestStyle: readDigestStyle(parsed.digestStyle),
    raw: parsed,
  };
}

export async function generateTopicProfileDraft(
  input: TopicProfileDraftInput,
  options: {
    adapter: TopicProfileDraftAdapter;
    model: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<TopicProfileDraft> {
  const response = await options.adapter.chat({
    jsonMode: true,
    maxTokens: options.maxTokens ?? 900,
    messages: buildTopicProfileDraftMessages(input),
    model: options.model,
    temperature: options.temperature ?? 0.2,
  });

  return parseTopicProfileDraftResponse(response.content);
}

/**
 * Deterministic fallback used when no AI is configured, the AI call is blocked
 * by quota, or the upstream provider fails. The output is intentionally
 * conservative: it derives keywords/entities from the natural-language input
 * and reuses baseline scope/importance rules so the user has something
 * concrete to confirm or edit.
 */
export function fallbackTopicProfileDraft(
  input: TopicProfileDraftInput,
): TopicProfileDraft {
  const name = sanitizeShortText(input.name, 120) || "未命名主题";
  const description = sanitizeLongText(input.description ?? "", 2_000);
  const terms = extractDraftTerms(`${name}\n${description}`);

  const keywords = terms.slice(0, 16);
  const entities = terms
    .filter((term) => /[A-Z][A-Za-z0-9-]*/.test(term) || /[\u4e00-\u9fff]{3,}/.test(term))
    .slice(0, 8);

  return {
    schemaVersion: TOPIC_PROFILE_DRAFT_SCHEMA_VERSION,
    source: "topic-profile-generator",
    generationMode: "rules",
    name,
    keywords,
    entities,
    includeScope: [
      description.trim() || name,
      "公开 RSS/Atom、官方博客、研究团队与工程团队更新。",
    ],
    excludeScope: [
      "广告软文与赞助内容",
      "无来源转载与重复搬运",
      "与主题核心目标无关的泛新闻",
    ],
    importanceRules: [
      "优先官方公告、一手博客、研究发布与产品更新。",
      "优先包含明确时间、来源链接、技术细节或影响范围的信息。",
      "降低纯观点、招聘启事与缺少来源的信息权重。",
    ],
    languagePreferences: {
      outputLanguage: DEFAULT_OUTPUT_LANGUAGE,
      terminologyRules: [],
    },
    digestStyle: { ...DEFAULT_DIGEST_STYLE },
    raw: {
      mode: "deterministic-fallback",
      reason: "AI unavailable; rules-based draft supplied.",
    },
  };
}

function readLanguagePreferences(
  value: unknown,
): TopicProfileLanguagePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { outputLanguage: DEFAULT_OUTPUT_LANGUAGE, terminologyRules: [] };
  }
  const record = value as Record<string, unknown>;
  const outputLanguage =
    typeof record.outputLanguage === "string" &&
    record.outputLanguage.trim().length > 0
      ? record.outputLanguage.trim().slice(0, 20)
      : DEFAULT_OUTPUT_LANGUAGE;

  return {
    outputLanguage,
    terminologyRules: sanitizeStringList(record.terminologyRules, 10, 120),
  };
}

function readDigestStyle(value: unknown): TopicProfileDigestStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DIGEST_STYLE };
  }
  const record = value as Record<string, unknown>;
  const structure = record.structure;
  const detailLevel = record.detailLevel;
  const rawMaxEvents = Number(record.maxEvents);
  const maxEvents =
    Number.isFinite(rawMaxEvents) && rawMaxEvents >= 1 && rawMaxEvents <= 50
      ? Math.floor(rawMaxEvents)
      : DEFAULT_DIGEST_STYLE.maxEvents;

  return {
    structure:
      typeof structure === "string" &&
      ["standard", "detailed", "compact"].includes(structure)
        ? (structure as TopicProfileDigestStyle["structure"])
        : DEFAULT_DIGEST_STYLE.structure,
    detailLevel:
      typeof detailLevel === "string" &&
      ["brief", "standard", "comprehensive"].includes(detailLevel)
        ? (detailLevel as TopicProfileDigestStyle["detailLevel"])
        : DEFAULT_DIGEST_STYLE.detailLevel,
    maxEvents,
  };
}

function sanitizeStringList(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const cleaned = sanitizeShortText(entry, maxItemLength);
    if (cleaned.length < 2) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeLongText(value: string, maxLength: number): string {
  return sanitizeShortText(value, maxLength);
}

const DRAFT_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "的",
  "了",
  "和",
  "与",
  "及",
  "关注",
  "跟踪",
  "观察",
  "相关",
  "持续",
  "实时",
  "最新",
]);

function extractDraftTerms(value: string): string[] {
  const tokenized = value
    .split(/[\s,，、;；:：/|()[\]{}"'“”‘’<>《》.!?！？\n\r\t]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !DRAFT_STOP_WORDS.has(term.toLowerCase()));

  const cjkPhrases = [...value.matchAll(/[\u4e00-\u9fff]{2,8}/g)].map(
    (match) => match[0],
  );

  const merged = [...tokenized, ...cjkPhrases];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of merged) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }
  return result;
}
