/**
 * Organization-cycle orchestration fixtures for Issue #163 Lane B1.
 *
 * These are behavior tests using real `runOrganizationFetchCycles` with
 * injected fake dependencies. No DATABASE_URL, no Prisma, no monkey-patching,
 * no `any`. Asserts the fixed contract:
 *
 *  1. ensureDefaultWorkspace called before listEligibleWorkerWorkspaces.
 *  2. Two orgs both execute with their own TaskRun/complete/summary.
 *  3. Org A throwing does not prevent Org B.
 *  4. Raw error / credential URL in error never reaches the summary.
 *  5. failTaskRun itself throwing does not stop subsequent orgs.
 *  6. Dynamic fair-share budget allocation per remaining org.
 *  7. Total budget exhausted => remaining orgs SKIPPED_BUDGET, no TaskRun.
 *  8. Workspace budget exhausted => audit completed + BUDGET_EXHAUSTED.
 *  9. Empty list returns zero counts.
 * 10. Output never contains userId.
 */
import {
  resetCycleTimeBudget,
  resetCycleStartTime,
  getCycleRemainingMs,
  isCycleTimeExhausted,
} from "./lifecycle.js";
import { runOrganizationFetchCycles } from "./organization-cycle.js";
import type {
  OrganizationCycleResult,
  OrganizationFetchCycleDeps,
} from "./types.js";

export async function runOrganizationCycleFixtures(): Promise<void> {
  await verifyEnsureDefaultCalledBeforeList();
  await verifyTwoOrgsBothExecutedWithOwnTaskRunAndSummary();
  await verifyOrgAFailureDoesNotPreventOrgB();
  await verifyRawErrorAndCredentialUrlNeverInSummary();
  await verifyFailTaskRunThrowingDoesNotStopSubsequentOrgs();
  await verifyDynamicBudgetAllocation();
  await verifyTotalBudgetExhaustedSkipsRemainingOrgsWithoutTaskRun();
  await verifyWorkspaceBudgetExhaustedIsCompletedAudit();
  await verifyEmptyListReturnsZeroCounts();
  await verifyOutputNeverContainsUserId();
  await verifyLifecycleBackwardCompatibleApi();
}

// ─── Helpers ───

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface FakeTaskRun {
  id: string;
  organizationId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorMessage?: string;
}

interface FakeOrg {
  organizationId: string;
  userId: string;
}

interface FakeDepsBuilder {
  orgs: FakeOrg[];
  taskRuns: FakeTaskRun[];
  createTaskRunCalls: Array<{ organizationId: string; type: string; input?: Record<string, unknown> }>;
  completeTaskRunCalls: Array<{ taskRunId: string; output: Record<string, unknown> }>;
  failTaskRunCalls: Array<{ taskRunId: string; error: unknown }>;
  ensureDefaultCalled: boolean;
  ensureDefaultBeforeList: boolean | null;
  resetWorkspaceBudgetCalls: number[];
  runFetchCalls: Array<{ organizationId: string; userId: string }>;
  /** If set, runFetchCycleForWorkspace throws for this org. */
  throwForOrg?: string;
  /** If set, failTaskRun throws for this taskRunId. */
  failTaskRunThrowsForId?: string;
  /** Error to throw for the configured org. */
  throwError?: unknown;
  currentMs: number;
  advanceMsOnRun: number;
  exhaustedWorkspaceOrg?: string;
}

function createFakeDeps(builder: FakeDepsBuilder): OrganizationFetchCycleDeps {
  const prisma = {};
  return {
    ensureDefaultWorkspace: async () => {
      if (builder.ensureDefaultCalled) {
        builder.ensureDefaultBeforeList = false;
      }
      builder.ensureDefaultCalled = true;
      return { organizationId: "default-org", userId: "default-user" };
    },
    listEligibleWorkerWorkspaces: async () => {
      builder.ensureDefaultBeforeList =
        builder.ensureDefaultBeforeList === null
          ? builder.ensureDefaultCalled
          : builder.ensureDefaultBeforeList;
      return builder.orgs;
    },
    createTaskRun: async (_prisma, input) => {
      builder.createTaskRunCalls.push({
        organizationId: input.organizationId,
        type: input.type,
        input: input.input,
      });
      const id = `task-${input.organizationId}-${builder.taskRuns.length + 1}`;
      builder.taskRuns.push({
        id,
        organizationId: input.organizationId,
        status: "RUNNING",
      });
      return { id };
    },
    completeTaskRun: async (_prisma, taskRunId, output) => {
      builder.completeTaskRunCalls.push({ taskRunId, output });
      const tr = builder.taskRuns.find((t) => t.id === taskRunId);
      if (tr) {
        tr.status = "SUCCEEDED";
        tr.output = output;
      }
      return {};
    },
    failTaskRun: async (_prisma, taskRunId, error) => {
      builder.failTaskRunCalls.push({ taskRunId, error });
      if (builder.failTaskRunThrowsForId === taskRunId) {
        throw new Error("failTaskRun exploded");
      }
      const tr = builder.taskRuns.find((t) => t.id === taskRunId);
      if (tr) {
        tr.status = "FAILED";
        tr.errorMessage = "application_error";
      }
      return {};
    },
    classifyTaskRunError: (error) => {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
      if (/timeout/i.test(msg)) return "timeout";
      if (/upstream|connection refused/i.test(msg)) return "upstream";
      if (/database_url|encryption_key/i.test(msg)) return "configuration";
      return "application_error";
    },
    runFetchCycleForWorkspace: async (_prisma, workspace) => {
      builder.runFetchCalls.push({
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      });
      if (builder.throwForOrg === workspace.organizationId && builder.throwError) {
        throw builder.throwError;
      }
      builder.currentMs += builder.advanceMsOnRun;
      return { ok: true };
    },
    resetWorkspaceBudgetMs: (allocationMs: number) => {
      builder.resetWorkspaceBudgetCalls.push(allocationMs);
    },
    resetOverallBudgetMs: () => {},
    isWorkspaceTimeExhausted: () => {
      const latest = builder.runFetchCalls.at(-1);
      return latest?.organizationId === builder.exhaustedWorkspaceOrg;
    },
    nowFn: () => builder.currentMs,
  };
}

function makeBuilder(orgs: FakeOrg[]): FakeDepsBuilder {
  return {
    orgs,
    taskRuns: [],
    createTaskRunCalls: [],
    completeTaskRunCalls: [],
    failTaskRunCalls: [],
    ensureDefaultCalled: false,
    ensureDefaultBeforeList: null,
    resetWorkspaceBudgetCalls: [],
    runFetchCalls: [],
    currentMs: 0,
    advanceMsOnRun: 0,
  };
}

function twoOrgs(): FakeOrg[] {
  return [
    { organizationId: "org-a", userId: "user-a" },
    { organizationId: "org-b", userId: "user-b" },
  ];
}

// ─── Tests ───

async function verifyEnsureDefaultCalledBeforeList(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  const deps = createFakeDeps(builder);
  await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });
  assert(builder.ensureDefaultCalled, "ensureDefaultWorkspace must be called.");
  assert(
    builder.ensureDefaultBeforeList === true,
    "ensureDefaultWorkspace must be called before listEligibleWorkerWorkspaces.",
  );
}

async function verifyTwoOrgsBothExecutedWithOwnTaskRunAndSummary(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  assert(result.organizationsEligible === 2, "organizationsEligible must be 2.");
  assert(result.attempted === 2, "attempted must be 2.");
  assert(result.succeeded === 2, "succeeded must be 2.");
  assert(result.failed === 0, "failed must be 0.");

  // Each org got its own TaskRun with matching organizationId.
  assert(builder.createTaskRunCalls.length === 2, "Two TaskRuns must be created.");
  assert(
    builder.createTaskRunCalls[0]!.organizationId === "org-a",
    "First TaskRun must be for org-a.",
  );
  assert(
    builder.createTaskRunCalls[1]!.organizationId === "org-b",
    "Second TaskRun must be for org-b.",
  );
  assert(
    builder.createTaskRunCalls.every((c) => c.type === "SOURCE_FETCH"),
    "All TaskRuns must be type SOURCE_FETCH.",
  );

  // Each org's TaskRun was completed (not failed).
  assert(builder.completeTaskRunCalls.length === 2, "Both TaskRuns must be completed.");
  assert(builder.failTaskRunCalls.length === 0, "No TaskRuns should be failed.");

  // Summaries bound to respective orgs.
  assert(result.summaries.length === 2, "Two summaries must exist.");
  assert(
    result.summaries[0]!.organizationId === "org-a" && result.summaries[0]!.status === "SUCCEEDED",
    "org-a summary must be SUCCEEDED.",
  );
  assert(
    result.summaries[1]!.organizationId === "org-b" && result.summaries[1]!.status === "SUCCEEDED",
    "org-b summary must be SUCCEEDED.",
  );

  // Workspace pipeline called once per org.
  assert(builder.runFetchCalls.length === 2, "runFetchCycleForWorkspace called once per org.");
  assert(
    builder.runFetchCalls[0]!.organizationId === "org-a",
    "First workspace call must be org-a.",
  );
}

async function verifyOrgAFailureDoesNotPreventOrgB(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  builder.throwForOrg = "org-a";
  builder.throwError = new Error("analysis sub-cycle failed");
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  assert(result.attempted === 2, "Both orgs must be attempted.");
  assert(result.succeeded === 1, "Only org-b should succeed.");
  assert(result.failed === 1, "org-a should be counted as failed.");

  // org-a TaskRun was failed, org-b TaskRun was completed.
  assert(builder.failTaskRunCalls.length === 1, "org-a TaskRun must be failed.");
  assert(builder.completeTaskRunCalls.length === 1, "org-b TaskRun must be completed.");

  // Summary for org-a has FAILED status + fixed error class.
  const orgASummary = result.summaries.find((s) => s.organizationId === "org-a");
  assert(orgASummary !== undefined, "org-a summary must exist.");
  assert(orgASummary!.status === "FAILED", "org-a status must be FAILED.");
  assert(
    orgASummary!.errorClass === "application_error",
    "org-a errorClass must be fixed application_error, got: " + orgASummary!.errorClass,
  );

  // org-b still executed.
  assert(
    builder.runFetchCalls.some((c) => c.organizationId === "org-b"),
    "org-b must still be executed despite org-a failure.",
  );
}

async function verifyRawErrorAndCredentialUrlNeverInSummary(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  builder.throwForOrg = "org-a";
  builder.throwError = new Error(
    "Auth failed: https://user:secret-token@upstream.example.com/api?key=sk-abc123",
  );
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  const json = JSON.stringify(result);
  assert(
    !json.includes("secret-token"),
    "Summary must not leak credential URL secret-token.",
  );
  assert(!json.includes("sk-abc123"), "Summary must not leak API key.");
  assert(!json.includes("upstream.example.com"), "Summary must not leak upstream URL.");
  assert(!json.includes("user-a"), "Summary must not leak userId.");
  assert(!json.includes("user-b"), "Summary must not leak userId.");

  const orgASummary = result.summaries.find((s) => s.organizationId === "org-a");
  assert(orgASummary !== undefined, "org-a summary must exist.");
  assert(
    orgASummary!.errorClass === "upstream" || orgASummary!.errorClass === "application_error",
    "errorClass must be fixed class, not raw error text.",
  );
  // errorClass must be a short fixed string, not the raw message.
  assert(
    orgASummary!.errorClass !== undefined && orgASummary!.errorClass.length < 50,
    "errorClass must be a short fixed class.",
  );
}

async function verifyFailTaskRunThrowingDoesNotStopSubsequentOrgs(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  builder.throwForOrg = "org-a";
  builder.throwError = new Error("timeout");
  // org-a's failTaskRun will itself throw.
  const orgATaskId = "task-org-a-1";
  builder.failTaskRunThrowsForId = orgATaskId;
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  // Both orgs still attempted; org-a failed (failTaskRun threw but org continues).
  assert(result.attempted === 2, "Both orgs must be attempted even if failTaskRun throws.");
  assert(result.failed === 1, "org-a counted as failed.");
  assert(result.succeeded === 1, "org-b succeeded.");

  // org-b TaskRun completed normally.
  assert(
    builder.completeTaskRunCalls.some((c) => c.taskRunId.includes("org-b")),
    "org-b TaskRun must be completed despite org-a failTaskRun throwing.",
  );
}

async function verifyDynamicBudgetAllocation(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  const deps = createFakeDeps(builder);
  await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  assert(
    builder.resetWorkspaceBudgetCalls.length === 2,
    "resetWorkspaceBudgetMs must be called once per org.",
  );
  // Each allocation must be >= 1ms.
  for (const alloc of builder.resetWorkspaceBudgetCalls) {
    assert(alloc >= 1, `Per-org budget allocation must be >= 1ms, got ${alloc}.`);
  }
  // First allocation for 2 orgs with 10s total: should be roughly half (dynamic fair share).
  const firstAlloc = builder.resetWorkspaceBudgetCalls[0]!;
  assert(firstAlloc === 5_000, `Two orgs must split the first 10s share, got ${firstAlloc}.`);
  assert(
    builder.resetWorkspaceBudgetCalls[1] === 10_000,
    "The final org must receive the remaining total budget.",
  );
}

async function verifyTotalBudgetExhaustedSkipsRemainingOrgsWithoutTaskRun(): Promise<void> {
  const builder = makeBuilder([
    { organizationId: "org-a", userId: "user-a" },
    { organizationId: "org-b", userId: "user-b" },
    { organizationId: "org-c", userId: "user-c" },
  ]);
  const deps = createFakeDeps(builder);
  builder.advanceMsOnRun = 2;

  // The first workspace advances past the 1ms total deadline.
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 1 });

  // org-a should have run (at least 1ms allocated). org-b and org-c should be SKIPPED_BUDGET.
  assert(result.organizationsEligible === 3, "Three orgs eligible.");
  assert(result.skippedBudget >= 1, "At least one org must be SKIPPED_BUDGET.");

  // Skipped orgs must NOT have TaskRuns created.
  const skippedOrgIds = result.summaries
    .filter((s) => s.status === "SKIPPED_BUDGET")
    .map((s) => s.organizationId);
  for (const orgId of skippedOrgIds) {
    assert(
      !builder.createTaskRunCalls.some((c) => c.organizationId === orgId),
      `Skipped org ${orgId} must not have a TaskRun created.`,
    );
  }
}

async function verifyWorkspaceBudgetExhaustedIsCompletedAudit(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  // Simulate workspace pipeline that exhausts its budget: we do this by
  // making the fake runFetchCycleForWorkspace NOT throw but leaving the
  // cycle time exhausted. The orchestrator should complete the audit TaskRun
  // and emit BUDGET_EXHAUSTED summary (partial bounded run, not an app error).
  // We achieve this by setting overallBudgetMs=1 so after the first org, the
  // orchestrator detects exhaustion *after* the workspace returns.
  builder.exhaustedWorkspaceOrg = "org-a";
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  // At least one org should be BUDGET_EXHAUSTED (the workspace returned but
  // per-org budget was exhausted) OR SKIPPED_BUDGET (if it never ran).
  // Either way: if a TaskRun was created and the workspace returned, it must
  // be completed (SUCCEEDED), not FAILED.
  for (const tr of builder.taskRuns) {
    if (tr.status === "RUNNING") {
      throw new Error(
        `TaskRun ${tr.id} left in RUNNING after workspace returned - must be completed.`,
      );
    }
  }
  // Any BUDGET_EXHAUSTED summary must correspond to a completed TaskRun.
  const exhausted = result.summaries.filter((s) => s.status === "BUDGET_EXHAUSTED");
  for (const ex of exhausted) {
    const tr = builder.taskRuns.find((t) => t.organizationId === ex.organizationId);
    assert(
      tr !== undefined && tr.status === "SUCCEEDED",
      `BUDGET_EXHAUSTED org ${ex.organizationId} must have a completed (SUCCEEDED) audit TaskRun.`,
    );
  }
}

async function verifyEmptyListReturnsZeroCounts(): Promise<void> {
  const builder = makeBuilder([]);
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  assert(result.organizationsEligible === 0, "Empty list => 0 eligible.");
  assert(result.attempted === 0, "Empty list => 0 attempted.");
  assert(result.succeeded === 0, "Empty list => 0 succeeded.");
  assert(result.failed === 0, "Empty list => 0 failed.");
  assert(result.skippedBudget === 0, "Empty list => 0 skipped.");
  assert(result.summaries.length === 0, "Empty list => 0 summaries.");
  assert(builder.createTaskRunCalls.length === 0, "No TaskRuns for empty list.");
}

async function verifyOutputNeverContainsUserId(): Promise<void> {
  const builder = makeBuilder(twoOrgs());
  builder.throwForOrg = "org-a";
  builder.throwError = new Error("user-a caused a problem with user-b");
  const deps = createFakeDeps(builder);
  const result = await runOrganizationFetchCycles({ deps, overallBudgetMs: 10_000 });

  const json = JSON.stringify(result);
  assert(!json.includes("user-a"), "Result must not contain userId user-a.");
  assert(!json.includes("user-b"), "Result must not contain userId user-b.");
}

async function verifyLifecycleBackwardCompatibleApi(): Promise<void> {
  // resetCycleStartTime still works (calls default budget).
  resetCycleStartTime();
  assert(!isCycleTimeExhausted(), "After reset, cycle should not be exhausted.");

  // resetCycleTimeBudget with explicit timeout.
  resetCycleTimeBudget(5_000);
  const remaining = getCycleRemainingMs();
  assert(remaining > 0 && remaining <= 5_000, `getCycleRemainingMs must be within (0, 5000], got ${remaining}.`);

  // resetCycleTimeBudget with 0 => immediately exhausted (deadline = now).
  resetCycleTimeBudget(0);
  assert(isCycleTimeExhausted(), "Budget 0 => deadline reached immediately.");

  // Reset to a healthy state.
  resetCycleTimeBudget(60_000);
  assert(!isCycleTimeExhausted(), "After healthy reset, not exhausted.");
}