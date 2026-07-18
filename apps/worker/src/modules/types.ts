export type WorkerCycleType = "fetch" | "task-runs" | "source-discovery" | "instant-push" | "report-generation" | "health";

/**
 * Minimal workspace scope required by worker business functions.
 * Callers that have a full `WorkspaceSeed` can pass it directly; this
 * interface guarantees only the two fields the pipeline actually reads.
 */
export interface WorkspaceScope {
  organizationId: string;
  userId: string;
}

export interface WorkerFetchCycleResult {
  analyzedItems: number;
  createdOrUpdatedEvents: number;
  failedSources: number;
  failedSubCycles: string[];
  fetchedSources: number;
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
