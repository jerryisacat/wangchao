export type WorkerCycleType = "fetch" | "source-discovery" | "instant-push" | "report-generation" | "health";

export interface WorkerFetchCycleResult {
  analyzedItems: number;
  createdOrUpdatedEvents: number;
  fetchedSources: number;
  failedSources: number;
  filteredItems: number;
  generatedBriefings: number;
  generatedMonthlyBriefings: number;
  generatedWeeklyBriefings: number;
  insertedOrUpdatedItems: number;
  lastError?: unknown;
  recordedSourceObservations: number;
  updatedPreferenceMemories: number;
}

export interface SourceDiscoveryCycleResult {
  aiRecommendationAttempts: number;
  aiRecommendationFallbacks: number;
  aiRecommendations: number;
  backlinkedCandidates: number;
  candidateSourcesWritten: number;
  existingSourcesObserved: number;
  failedCandidates: number;
  keywordCandidates: number;
  outlinkCandidates: number;
  skippedKeywordSearch: boolean;
  taskRunId: string;
  topicsScanned: number;
}

export interface SourceDiscoveryCycleOptions {
  mode?: "manual" | "worker";
  userId?: string;
}

export interface WorkerHealthCheckResult {
  checks: Record<string, { message?: string; status: "ok" | "down" | "skipped" }>;
  generatedAt: string;
  service: "wangchao-worker";
  status: "ok" | "degraded";
}

export interface InstantPushCycleResult {
  organizations: number;
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export interface TelegramDeliveryResult {
  delivered: number;
  failed: number;
  skipped: number;
}

export interface ReportGenerationCycleResult {
  scanned: number;
  generated: number;
  failed: number;
}

export interface ReportGenerationInput {
  reportId: string;
  organizationId: string;
  userId: string;
}

export type DiscoveryChannel =
  | "backlink-from-highscore"
  | "keyword-search"
  | "outlink-network";
