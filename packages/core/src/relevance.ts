import { createEventHash, createTitleHash, normalizeTitle } from "./hashing.js";
import {
  readProfileRecord,
  readProfileStringList,
} from "./topic-profile.js";
import type { PreferenceSnapshot } from "./preference.js";

const RELEVANCE_MAX_SCORE = 98;
const RELEVANCE_BASE_POSITIVE = 72;
const RELEVANCE_BASE_WEAK = 42;
const RELEVANCE_KEYWORD_BONUS = 8;
const RELEVANCE_ENTITY_BONUS = 6;
const RELEVANCE_INCLUDE_SCOPE_BONUS = 6;
const RELEVANCE_THRESHOLD = 70;

/**
 * Issue #170: gravityScore 拆分为四个独立维度的版本化明细。
 * `scoringVersion=1` 表示旧事件（rawAiResponse 无 scoring 块）的兼容回退。
 * `scoringVersion=2` 引入 relevanceScore / importanceScore / sourceQualityFactor / preferenceAdjustment 四维分离。
 */
export interface ScoringBreakdown {
  relevanceScore: number;
  importanceScore: number;
  sourceQualityFactor: number;
  preferenceAdjustment: number;
  scoringVersion: number;
}

/**
 * 来源质量因子缺省：无 Source 质量数据时按中性 1.0 处理。
 */
const DEFAULT_SOURCE_QUALITY_FACTOR = 1;
/**
 * 偏好调整缺省：写入时不应用偏好，默认 1.0（偏好影响在读路径 applyPreferenceWeights）。
 */
const DEFAULT_PREFERENCE_ADJUSTMENT = 1;
/**
 * 当前评分公式版本。旧事件 rawAiResponse 无 scoring 块时按 v1 解析。
 */
export const CURRENT_SCORING_VERSION = 2;

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
  scoringBreakdown: ScoringBreakdown;
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

export interface AiEventExtraction {
  category: string;
  entities: string[];
  followUpSuggestion: string;
  importanceExplanation: string;
  importanceScore: number;
  isRelevant: boolean;
  matchedKeywords: string[];
  noiseReason?: string;
  relevanceScore: number;
  summary: string;
  title: string;
}

export interface EvaluateRelevanceOptions {
  /**
   * Issue #165: 偏好快照。传入后，evaluateRelevance 会：
   *   - 把 snapshot.mutedKeywords + mutedScopes 合并进 excludeScope 匹配集
   *     （仅当 explorationRollout.muteKeywords/muteScopes 为 true 时生效，
   *      即探索窗口关闭时；探索窗口打开时不应用 mute，放过该类内容）。
   *   - 把 snapshot.boostedKeywords 合并进 keywords 匹配集（只加不减）。
   * 不传或传 null/undefined 时行为与改动前完全一致（向后兼容）。
   */
  preferenceSnapshot?: PreferenceSnapshot | null;
}

export function evaluateRelevance(
  item: IntelligenceInputItem,
  options?: EvaluateRelevanceOptions,
): RelevanceDecision {
  const profile = readProfileRecord(item.topicProfile);
  const profileKeywords = readProfileStringList(profile.keywords);
  const profileEntities = readProfileStringList(profile.entities);
  const profileIncludeScopes = readProfileStringList(profile.includeScope);
  const profileExcludeScopes = readProfileStringList(profile.excludeScope);
  const snapshot = options?.preferenceSnapshot ?? null;

  // Issue #165: 合并偏好快照。
  // - boostedKeywords 只加不减（正向偏好补充 profile keywords）。
  // - mutedKeywords / mutedScopes 受 explorationRollout 门控：
  //   探索窗口关闭时并入 excludeScope，打开时不应用（放过新内容）。
  const boostedKeywords =
    snapshot && snapshot.boostedKeywords.length > 0
      ? Array.from(new Set([...profileKeywords, ...snapshot.boostedKeywords]))
      : profileKeywords;
  const extraExcludeScopes: string[] = [];
  if (snapshot) {
    if (
      snapshot.mutedScopes.length > 0 &&
      snapshot.explorationRollout.muteScopes
    ) {
      for (const scope of snapshot.mutedScopes) {
        if (!profileExcludeScopes.includes(scope)) {
          extraExcludeScopes.push(scope);
        }
      }
    }
    // mutedKeywords 与 mutedScopes 同源（都来自 category mute）。
    // 这里用 muteScopes 门控同一组 mute（语义一致：探索窗口决定该类 mute 是否生效）。
    if (
      snapshot.mutedKeywords.length > 0 &&
      snapshot.explorationRollout.muteKeywords
    ) {
      for (const keyword of snapshot.mutedKeywords) {
        if (!extraExcludeScopes.includes(keyword)) {
          extraExcludeScopes.push(keyword);
        }
      }
    }
  }
  const excludeScopes =
    extraExcludeScopes.length > 0
      ? Array.from(new Set([...profileExcludeScopes, ...extraExcludeScopes]))
      : profileExcludeScopes;

  const keywords = boostedKeywords;
  const entities = profileEntities;
  const includeScopes = profileIncludeScopes;
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
    RELEVANCE_MAX_SCORE,
    (hasPositiveSignal ? RELEVANCE_BASE_POSITIVE : RELEVANCE_BASE_WEAK) +
      matchedKeywords.length * RELEVANCE_KEYWORD_BONUS +
      matchedEntities.length * RELEVANCE_ENTITY_BONUS +
      matchedIncludeScopes.length * RELEVANCE_INCLUDE_SCOPE_BONUS,
  );

  return {
    isRelevant: score >= RELEVANCE_THRESHOLD,
    matchedEntities,
    matchedExcludeScopes,
    matchedIncludeScopes,
    matchedKeywords,
    noiseReason: score >= RELEVANCE_THRESHOLD ? undefined : "No positive topic profile signals matched.",
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

  // 规则路径：无法独立评估重要性，用相关性分数近似（v1 兼容语义）。
  const importanceScore = decision.score;
  const sourceQualityFactor = DEFAULT_SOURCE_QUALITY_FACTOR;
  const preferenceAdjustment = DEFAULT_PREFERENCE_ADJUSTMENT;
  const gravityScore = calculateGravityScore({
    relevanceScore: decision.score,
    importanceScore,
    sourceQualityFactor,
    preferenceAdjustment,
    occurredAt,
    now: new Date(),
  });
  const scoringBreakdown: ScoringBreakdown = {
    relevanceScore: decision.score,
    importanceScore,
    sourceQualityFactor,
    preferenceAdjustment,
    scoringVersion: CURRENT_SCORING_VERSION,
  };

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
    scoringBreakdown,
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

export function createIntelligenceEventDraftFromExtraction(
  item: IntelligenceInputItem,
  extraction: AiEventExtraction,
  options?: { sourceQualityFactor?: number; preferenceAdjustment?: number },
): IntelligenceEventDraft | null {
  if (!extraction.isRelevant) {
    return null;
  }

  const occurredAt = item.publishedAt ?? item.fetchedAt;
  const eventHash = createEventHash(
    `${normalizeTitle(item.title)}\n${item.url}`,
  );
  const titleHash = createTitleHash(item.title);
  const sourceQualityFactor =
    options?.sourceQualityFactor ?? DEFAULT_SOURCE_QUALITY_FACTOR;
  const preferenceAdjustment =
    options?.preferenceAdjustment ?? DEFAULT_PREFERENCE_ADJUSTMENT;
  const importanceScore = extraction.importanceScore ?? extraction.relevanceScore;
  const gravityScore = calculateGravityScore({
    relevanceScore: extraction.relevanceScore,
    importanceScore,
    sourceQualityFactor,
    preferenceAdjustment,
    occurredAt,
    now: new Date(),
  });
  const scoringBreakdown: ScoringBreakdown = {
    relevanceScore: extraction.relevanceScore,
    importanceScore,
    sourceQualityFactor,
    preferenceAdjustment,
    scoringVersion: CURRENT_SCORING_VERSION,
  };

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
    scoringBreakdown,
    summary: extraction.summary,
    title: extraction.title,
    titleHash,
  };
}

export interface GravityScoreInput {
  relevanceScore: number;
  importanceScore: number;
  sourceQualityFactor?: number;
  preferenceAdjustment?: number;
  occurredAt: Date;
  now: Date;
}

/**
 * Issue #170: 综合排序分 = f(relevanceScore, importanceScore, sourceQualityFactor, preferenceAdjustment, time)。
 *
 * 公式版本 v2（CURRENT_SCORING_VERSION=2）：
 *   effectiveBase = relevanceScore * 0.5 + importanceScore * 0.5
 *   timeDecay = (offset / (ageHours + offset)) ** gravity
 *   gravityScore = effectiveBase * timeDecay * clamp(sourceQualityFactor, 0.2, 2) * clamp(preferenceAdjustment, 0.4, 1.6)
 *
 * 与 v1 兼容：当 importanceScore 缺失时回退到 relevanceScore（见 resolveScoringBreakdown），
 * sourceQualityFactor/preferenceAdjustment 缺失时回退到 1.0，结果与旧公式一致。
 */
export function calculateGravityScore(input: GravityScoreInput): number {
  const {
    relevanceScore,
    importanceScore,
    occurredAt,
    now,
  } = input;
  const sourceQualityFactor = clampFactor(
    input.sourceQualityFactor ?? DEFAULT_SOURCE_QUALITY_FACTOR,
    0.2,
    2,
  );
  const preferenceAdjustment = clampFactor(
    input.preferenceAdjustment ?? DEFAULT_PREFERENCE_ADJUSTMENT,
    0.4,
    1.6,
  );

  const ageHours = Math.max(
    0,
    (now.getTime() - occurredAt.getTime()) / (1000 * 60 * 60),
  );
  const offset = 6;
  // 相关性是准入门，重要性决定高度；两者各占一半。
  const effectiveBase = relevanceScore * 0.5 + importanceScore * 0.5;
  const effectiveGravity = effectiveBase >= 90 ? 0.9 : 1.15;
  const timeDecay = (offset / (ageHours + offset)) ** effectiveGravity;

  return Number(
    (
      effectiveBase *
      timeDecay *
      sourceQualityFactor *
      preferenceAdjustment
    ).toFixed(4),
  );
}

function clampFactor(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * 旧事件重算策略：rawAiResponse 没有 scoring 块时按 v1 兼容解析。
 * v1 语义：importanceScore = relevanceScore（旧 score 字段），sourceQualityFactor = 1，preferenceAdjustment = 1。
 * 调用方（Dashboard / 重算任务）据此决定是否用 v2 公式重算。
 */
export function resolveScoringBreakdown(input: {
  rawAiResponse?: Record<string, unknown> | null;
  score: number;
  gravityScore: number;
}): ScoringBreakdown {
  const scoring = input.rawAiResponse?.scoring;
  if (
    scoring &&
    typeof scoring === "object" &&
    "scoringVersion" in scoring
  ) {
    const block = scoring as Record<string, unknown>;
    return {
      relevanceScore:
        typeof block.relevanceScore === "number"
          ? block.relevanceScore
          : input.score,
      importanceScore:
        typeof block.importanceScore === "number"
          ? block.importanceScore
          : input.score,
      sourceQualityFactor:
        typeof block.sourceQualityFactor === "number"
          ? block.sourceQualityFactor
          : DEFAULT_SOURCE_QUALITY_FACTOR,
      preferenceAdjustment:
        typeof block.preferenceAdjustment === "number"
          ? block.preferenceAdjustment
          : DEFAULT_PREFERENCE_ADJUSTMENT,
      scoringVersion:
        typeof block.scoringVersion === "number"
          ? block.scoringVersion
          : 1,
    };
  }
  // v1 兼容回退
  return {
    relevanceScore: input.score,
    importanceScore: input.score,
    sourceQualityFactor: DEFAULT_SOURCE_QUALITY_FACTOR,
    preferenceAdjustment: DEFAULT_PREFERENCE_ADJUSTMENT,
    scoringVersion: 1,
  };
}
