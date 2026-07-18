import type { TaskRunErrorClass } from "@wangchao/db";

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
  autoMutedSources: number;
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

// ─── Organization-cycle orchestration (Issue #163 Lane B1) ───

/**
 * Fixed status union for a single organization within a cycle. Never includes
 * raw error text, user IDs, or credentials.
 */
export type OrganizationCycleStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED_BUDGET"
  | "BUDGET_EXHAUSTED";

export interface OrganizationCycleSummary {
  organizationId: string;
  status: OrganizationCycleStatus;
  /** Fixed low-cardinality error class, only present when status === FAILED. */
  errorClass?: TaskRunErrorClass;
}

export interface OrganizationCycleResult {
  organizationsEligible: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedBudget: number;
  summaries: OrganizationCycleSummary[];
}

/**
 * Production default dependencies for `runOrganizationFetchCycles`.
 * Every dependency is injectable so the fixtures can exercise real functions
 * with fakes (no monkey-patching, no `any`).
 */
export interface OrganizationFetchCycleDeps {
  /** Ensures the fresh self-hosted default workspace exists before listing. */
  ensureDefaultWorkspace: (prisma: unknown) => Promise<unknown>;
  /** Lists eligible worker workspaces (one actor per org, stable order). */
  listEligibleWorkerWorkspaces: (prisma: unknown) => Promise<
    Array<{ organizationId: string; userId: string }>
  >;
  /** Creates the outer audit TaskRun for an org (type SOURCE_FETCH, worker scope). */
  createTaskRun: (
    prisma: unknown,
    input: {
      organizationId: string;
      type: "SOURCE_FETCH";
      input?: Record<string, unknown>;
      maxAttempts?: number;
    },
  ) => Promise<{ id: string }>;
  /** Completes the outer audit TaskRun. */
  completeTaskRun: (
    prisma: unknown,
    taskRunId: string,
    output: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Fails the outer audit TaskRun with a fixed error class. */
  failTaskRun: (
    prisma: unknown,
    taskRunId: string,
    error: unknown,
  ) => Promise<unknown>;
  /** Classifies a raw error into a fixed low-cardinality string. */
  classifyTaskRunError: (error: unknown) => TaskRunErrorClass;
  /** Runs the workspace pipeline scoped to one org/actor. */
  runFetchCycleForWorkspace: (
    prisma: unknown,
    workspace: { organizationId: string; userId: string },
  ) => Promise<unknown>;
  /**
   * Resets the per-workspace time budget to `allocationMs`. Called before
   * each org with the dynamically computed fair share (≥1ms, never past the
   * overall deadline). The workspace pipeline reads the remaining time via
   * `isCycleTimeExhausted` / `getCycleRemainingMs`.
   */
  resetWorkspaceBudgetMs: (allocationMs: number) => void;
  resetOverallBudgetMs: (budgetMs: number) => void;
  isWorkspaceTimeExhausted: () => boolean;
  nowFn: () => number;
}

export interface RunOrganizationFetchCyclesOptions {
  /**
   * Total cycle budget in milliseconds. Must be a finite positive integer.
   * Mutually exclusive with `budgetExhausted`: when `budgetExhausted` is true
   * the orchestrator skips every org with SKIPPED_BUDGET and never resets the
   * lifecycle budget (no fresh 4-minute allocation).
   */
  overallBudgetMs?: number;
  /**
   * When true, the durable queue drain already consumed the entire cycle
   * budget. The orchestrator must return every eligible org as
   * SKIPPED_BUDGET without allocating any new budget and without invoking
   * `runFetchCycleForWorkspace`. This is the explicit API for the
   * "remaining <= 0" case — callers must NOT pass `overallBudgetMs: 0`
   * (that would trip the budget validation in `assertBudget`).
   */
  budgetExhausted?: boolean;
  /** Inject all dependencies (fixtures). Production callers omit this. */
  deps?: OrganizationFetchCycleDeps;
  prisma?: unknown;
}
/**
 * Result of the main worker cycle (Issue #163 Lane B2): drains the durable
 * TaskRun queue under a single overall budget, then runs the multi-org fetch
 * cycle with whatever budget remains. Never contains userId or raw error
 * text - fetch summaries only carry organizationId / status / fixed
 * errorClass.
 */
export interface MainWorkerCycleResult {
  taskRuns: {
    recovered: number;
    finalized: number;
    claimed: number;
    succeeded: number;
    retried: number;
    failed: number;
    ownershipLost: number;
  };
  fetch: OrganizationCycleResult;
}
