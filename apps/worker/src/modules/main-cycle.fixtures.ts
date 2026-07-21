/**
 * Main-cycle orchestrator fixtures for Issue #163 Lane B2.
 *
 * These fixtures exercise the small injectable `runMainCycleOrchestrator`
 * extracted from `index.ts` and the standalone `runFetchCycle` multi-org
 * entry moved to `organization-cycle.ts`.
 *
 * Contract under test:
 *  1. Main cycle resets the overall budget exactly ONCE, before draining.
 *  2. Consumer drain runs BEFORE org fetch.
 *  3. If consumer exhausts the budget, fetch receives NO new budget
 *     (budgetExhausted: true), not a fresh 4-minute reset.
 *  4. If consumer leaves remaining budget, fetch receives only that remainder.
 *  5. Standalone fetch CLI initializes its own fresh budget.
 *  6. Main result JSON never contains userId or raw error text.
 */
import { runMainCycleOrchestrator } from "../index.js";
import { runFetchCycle } from "./organization-cycle.js";
import type {
  OrganizationCycleResult,
  RunOrganizationFetchCyclesOptions,
} from "./types.js";

interface FakeOrgSummary {
  organizationId: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED_BUDGET" | "BUDGET_EXHAUSTED";
  errorClass?: string;
}

interface FakeMainDeps {
  resetCalls: Array<number | undefined>;
  remainingMs: number;
  softTimeoutMs: number;
  taskRunsResult: { claimed: number; succeeded: number };
  orgFetchResult: OrganizationCycleResult;
  orgFetchCalls: RunOrganizationFetchCyclesOptions[];
  budgetExhaustedCalls: number;
}

function makeFakeDeps(overrides: Partial<FakeMainDeps> = {}): FakeMainDeps {
  return {
    resetCalls: [],
    remainingMs: 240_000,
    softTimeoutMs: 240_000,
    taskRunsResult: { claimed: 0, succeeded: 0 },
    orgFetchResult: emptyOrgResult(),
    orgFetchCalls: [],
    budgetExhaustedCalls: 0,
    ...overrides,
  };
}

function emptyOrgResult(): OrganizationCycleResult {
  return {
    organizationsEligible: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedBudget: 0,
    summaries: [],
  };
}

function buildMainDeps(fake: FakeMainDeps) {
  return {
    resetCycleTimeBudget: (timeoutMs?: number) => {
      fake.resetCalls.push(timeoutMs);
    },
    getCycleRemainingMs: () => fake.remainingMs,
    getSoftTimeoutMs: () => fake.softTimeoutMs,
    runTaskRunConsumerCycle: async () => ({ ...fake.taskRunsResult } as never),
    runOrganizationFetchCycles: async (options?: RunOrganizationFetchCyclesOptions) => {
      fake.orgFetchCalls.push(options ?? {});
      if (options?.budgetExhausted === true) {
        fake.budgetExhaustedCalls++;
      }
      return { ...fake.orgFetchResult, summaries: [...fake.orgFetchResult.summaries] };
    },
  };
}

export async function runMainCycleOrchestratorFixtures(): Promise<void> {
  await verifyBudgetResetOnceBeforeDrain();
  await verifyConsumerDrainBeforeOrgFetch();
  await verifyConsumerExhaustsBudgetFetchGetsNoNewBudget();
  await verifyConsumerLeavesRemainderFetchGetsOnlyRemainder();
  await verifyStandaloneFetchInitializesBudget();
  await verifyMainResultNoUserIdOrRawError();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ─── Tests ───

async function verifyBudgetResetOnceBeforeDrain(): Promise<void> {
  const fake = makeFakeDeps();
  const deps = buildMainDeps(fake);
  let drainCalled = false;
  const wrappedDeps = {
    ...deps,
    runTaskRunConsumerCycle: async () => {
      drainCalled = true;
      assert(fake.resetCalls.length === 1, "Budget must be reset before drain.");
      return deps.runTaskRunConsumerCycle();
    },
  };
  await runMainCycleOrchestrator(wrappedDeps);
  assert(
    fake.resetCalls.length === 1,
    "Main cycle must reset the overall budget exactly once, got: " + fake.resetCalls.length,
  );
  assert(
    fake.resetCalls[0] === fake.softTimeoutMs,
    "Reset must use getSoftTimeoutMs as the budget, got: " + fake.resetCalls[0],
  );
  assert(drainCalled, "Consumer drain must be called.");
}

async function verifyConsumerDrainBeforeOrgFetch(): Promise<void> {
  const fake = makeFakeDeps();
  const deps = buildMainDeps(fake);
  const callOrder: string[] = [];
  const wrappedDeps = {
    ...deps,
    runTaskRunConsumerCycle: async () => {
      callOrder.push("drain");
      return deps.runTaskRunConsumerCycle();
    },
    runOrganizationFetchCycles: async (options?: RunOrganizationFetchCyclesOptions) => {
      callOrder.push("fetch");
      return deps.runOrganizationFetchCycles(options);
    },
  };
  await runMainCycleOrchestrator(wrappedDeps);
  assert(callOrder.length === 2, "Must call drain and fetch, got: " + callOrder.length);
  assert(
    callOrder[0] === "drain" && callOrder[1] === "fetch",
    "Drain must run before org fetch, got: " + callOrder.join(","),
  );
}

async function verifyConsumerExhaustsBudgetFetchGetsNoNewBudget(): Promise<void> {
  const fake = makeFakeDeps({
    remainingMs: 0,
    orgFetchResult: {
      organizationsEligible: 2,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skippedBudget: 2,
      summaries: [
        { organizationId: "org-a", status: "SKIPPED_BUDGET" },
        { organizationId: "org-b", status: "SKIPPED_BUDGET" },
      ],
    },
  });
  const deps = buildMainDeps(fake);
  const result = await runMainCycleOrchestrator(deps);

  assert(
    fake.budgetExhaustedCalls === 1,
    "When remaining is 0, orchestrator must call runOrganizationFetchCycles with budgetExhausted:true exactly once.",
  );
  assert(
    fake.orgFetchCalls.length === 1,
    "Orchestrator must call runOrganizationFetchCycles exactly once.",
  );
  assert(
    fake.orgFetchCalls[0]?.budgetExhausted === true,
    "When remaining is 0, options must have budgetExhausted:true (not overallBudgetMs:0).",
  );
  assert(
    fake.orgFetchCalls[0]?.overallBudgetMs === undefined,
    "When budget exhausted, overallBudgetMs must not be set (avoids validation).",
  );
  assert(
    result.fetch.skippedBudget === 2,
    "Fetch must return SKIPPED_BUDGET summaries for all eligible orgs.",
  );
}

async function verifyConsumerLeavesRemainderFetchGetsOnlyRemainder(): Promise<void> {
  const fake = makeFakeDeps({
    remainingMs: 30_000,
  });
  const deps = buildMainDeps(fake);
  await runMainCycleOrchestrator(deps);

  assert(
    fake.orgFetchCalls.length === 1,
    "Orchestrator must call runOrganizationFetchCycles exactly once.",
  );
  assert(
    fake.orgFetchCalls[0]?.overallBudgetMs === 30_000,
    "When remaining > 0, fetch must receive only the remainder (30_000), not a fresh reset, got: " + fake.orgFetchCalls[0]?.overallBudgetMs,
  );
  assert(
    fake.orgFetchCalls[0]?.budgetExhausted !== true,
    "When remaining > 0, budgetExhausted must not be set.",
  );
  assert(
    fake.resetCalls.length === 1,
    "Budget must still be reset only once (no second reset for fetch).",
  );
}

async function verifyStandaloneFetchInitializesBudget(): Promise<void> {
  // Standalone `fetch` CLI calls runFetchCycle() which lives in organization-cycle.
  // It must initialize its own fresh budget before running orgs.
  // We verify by injecting deps into runOrganizationFetchCycles via its
  // own deps mechanism (not main-cycle deps).
  let resetCalled = false;
  const orgDeps = createStandaloneFetchTestDeps({
    resetCycleTimeBudget: () => { resetCalled = true; },
    listEligibleResult: [
      { organizationId: "org-a", userId: "user-a" },
    ],
  });
  await runFetchCycle({ deps: orgDeps.deps, overallBudgetMs: 10_000 });

  assert(resetCalled, "Standalone fetch must reset cycle budget before running orgs.");
}

async function verifyMainResultNoUserIdOrRawError(): Promise<void> {
  const fake = makeFakeDeps({
    orgFetchResult: {
      organizationsEligible: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skippedBudget: 0,
      summaries: [
        { organizationId: "org-a", status: "SUCCEEDED" },
        {
          organizationId: "org-b",
          status: "FAILED",
          errorClass: "upstream",
        },
      ],
    },
  });
  const deps = buildMainDeps(fake);
  const result = await runMainCycleOrchestrator(deps);
  const json = JSON.stringify(result);

  // The result must not contain userId or raw error text.
  // (Fake orgFetchResult never includes userId, and errorClass is a fixed class.)
  assert(!json.includes("user-a"), "Result must not contain userId.");
  assert(!json.includes("user-b"), "Result must not contain userId.");
  assert(!json.includes("raw"), "Result must not contain raw error text.");
  assert(json.includes("org-a"), "Result must contain organizationId.");
  assert(json.includes("upstream"), "Result must contain fixed errorClass.");
  assert(
    result.fetch.summaries.length === 2,
    "Fetch must include per-org summaries.",
  );
}

// ─── Standalone fetch test helpers ───

interface StandaloneFetchTestConfig {
  resetCycleTimeBudget: (timeoutMs?: number) => void;
  listEligibleResult: Array<{ organizationId: string; userId: string }>;
}

function createStandaloneFetchTestDeps(config: StandaloneFetchTestConfig): {
  deps: import("./types.js").OrganizationFetchCycleDeps;
} {
  const taskRuns: Array<{ id: string; organizationId: string; status: string }> = [];
  return {
    deps: {
      ensureDefaultWorkspace: async () => ({ organizationId: "default", userId: "default" }),
      listEligibleWorkerWorkspaces: async () => config.listEligibleResult,
      createTaskRun: async (_prisma, input) => {
        const id = `task-${input.organizationId}`;
        taskRuns.push({ id, organizationId: input.organizationId, status: "RUNNING" });
        return { id };
      },
      completeTaskRun: async (_prisma, taskRunId) => {
        const tr = taskRuns.find((t) => t.id === taskRunId);
        if (tr) tr.status = "SUCCEEDED";
        return {};
      },
      failTaskRun: async () => ({}),
      classifyTaskRunError: () => "application_error" as never,
      runFetchCycleForWorkspace: async () => ({ ok: true }),
      resetWorkspaceBudgetMs: () => {},
      resetOverallBudgetMs: (budgetMs) => { config.resetCycleTimeBudget(budgetMs); },
      isWorkspaceTimeExhausted: () => false,
      nowFn: () => 0,
    },
  };
}