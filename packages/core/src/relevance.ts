import { createEventHash, createTitleHash, normalizeTitle } from "./hashing.js";
import {
  readProfileRecord,
  readProfileStringList,
} from "./topic-profile.js";

const RELEVANCE_MAX_SCORE = 98;
const RELEVANCE_BASE_POSITIVE = 72;
const RELEVANCE_BASE_WEAK = 42;
const RELEVANCE_KEYWORD_BONUS = 8;
const RELEVANCE_ENTITY_BONUS = 6;
const RELEVANCE_INCLUDE_SCOPE_BONUS = 6;
const RELEVANCE_THRESHOLD = 70;

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
