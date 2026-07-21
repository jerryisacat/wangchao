import {
  classifyTaskRunError,
  completeTaskRun,
  createTaskRun,
  ensureDefaultWorkspace,
  failTaskRun,
  getPrismaClient,
  listEligibleWorkerWorkspaces,
} from "@wangchao/db";
import { getSoftTimeoutMs } from "./env.js";
import { isCycleTimeExhausted, resetCycleTimeBudget } from "./lifecycle.js";
import { runFetchCycleForWorkspace } from "./fetch-cycle.js";
import type {
  OrganizationCycleResult,
  OrganizationCycleStatus,
  OrganizationCycleSummary,
  OrganizationFetchCycleDeps,
  RunOrganizationFetchCyclesOptions,
} from "./types.js";

const MAX_OVERALL_BUDGET_MS = 24 * 60 * 60 * 1_000;

type PrismaClient = ReturnType<typeof getPrismaClient>;

interface ResolvedOrganizationCycleContext {
  budgetMs: number;
  deadlineMs: number;
  deps: OrganizationFetchCycleDeps;
  prisma: unknown;
}

export async function runOrganizationFetchCycles(
  options: RunOrganizationFetchCyclesOptions = {},
): Promise<OrganizationCycleResult> {
  if (options.budgetExhausted === true) return enumerateBudgetSkips(options);
  const context = resolveContext(options);
  await context.deps.ensureDefaultWorkspace(context.prisma);
  const workspaces = await context.deps.listEligibleWorkerWorkspaces(context.prisma);
  const result = emptyResult(workspaces.length);

  for (let index = 0; index < workspaces.length; index += 1) {
    const workspace = workspaces[index]!;
    const remainingMs = context.deadlineMs - context.deps.nowFn();
    if (remainingMs <= 0) {
      appendBudgetSkips(result, workspaces.slice(index));
      break;
    }
    const remainingOrganizations = workspaces.length - index;
    const allocationMs = Math.max(1, Math.floor(remainingMs / remainingOrganizations));
    context.deps.resetWorkspaceBudgetMs(allocationMs);
    const summary = await runWorkspace(context, workspace);
    recordSummary(result, summary);
  }
  return result;
}

export async function runFetchCycle(
  options: RunOrganizationFetchCyclesOptions = {},
): Promise<OrganizationCycleResult> {
  if (!process.env.DATABASE_URL && options.deps === undefined) {
    throw new Error("Database connection is required to run the worker fetch pipeline.");
  }
  const budgetMs = options.overallBudgetMs ?? getSoftTimeoutMs();
  (options.deps?.resetOverallBudgetMs ?? resetCycleTimeBudget)(budgetMs);
  return runOrganizationFetchCycles({ ...options, overallBudgetMs: budgetMs });
}

async function enumerateBudgetSkips(
  options: RunOrganizationFetchCyclesOptions,
): Promise<OrganizationCycleResult> {
  const deps = options.deps ?? createDefaultDeps();
  const prisma = options.prisma ?? (options.deps ? {} : getPrismaClient());
  await deps.ensureDefaultWorkspace(prisma);
  const workspaces = await deps.listEligibleWorkerWorkspaces(prisma);
  const result = emptyResult(workspaces.length);
  appendBudgetSkips(result, workspaces);
  return result;
}

function resolveContext(
  options: RunOrganizationFetchCyclesOptions,
): ResolvedOrganizationCycleContext {
  const deps = options.deps ?? createDefaultDeps();
  const budgetMs = options.overallBudgetMs ?? getSoftTimeoutMs();
  assertBudget(budgetMs);
  return {
    budgetMs,
    deadlineMs: deps.nowFn() + budgetMs,
    deps,
    prisma: options.prisma ?? (options.deps ? {} : getPrismaClient()),
  };
}

async function runWorkspace(
  context: ResolvedOrganizationCycleContext,
  workspace: { organizationId: string; userId: string },
): Promise<OrganizationCycleSummary> {
  let taskRunId: string | null = null;
  try {
    const taskRun = await context.deps.createTaskRun(context.prisma, {
      organizationId: workspace.organizationId,
      type: "SOURCE_FETCH",
      input: { mode: "worker", scope: "organization-cycle" },
    });
    taskRunId = taskRun.id;
    await context.deps.runFetchCycleForWorkspace(context.prisma, workspace);
    const status: OrganizationCycleStatus = context.deps.isWorkspaceTimeExhausted()
      ? "BUDGET_EXHAUSTED"
      : "SUCCEEDED";
    await context.deps.completeTaskRun(context.prisma, taskRun.id, {
      scope: "organization-cycle",
      status,
    });
    return { organizationId: workspace.organizationId, status };
  } catch (error) {
    const errorClass = context.deps.classifyTaskRunError(error);
    if (taskRunId !== null) await safelyFailTaskRun(context, taskRunId, error);
    return { organizationId: workspace.organizationId, status: "FAILED", errorClass };
  }
}

async function safelyFailTaskRun(
  context: ResolvedOrganizationCycleContext,
  taskRunId: string,
  error: unknown,
): Promise<void> {
  try {
    await context.deps.failTaskRun(context.prisma, taskRunId, error);
  } catch {
    // Settlement failure is isolated to this organization. Never emit raw errors.
  }
}

function recordSummary(
  result: OrganizationCycleResult,
  summary: OrganizationCycleSummary,
): void {
  result.attempted += 1;
  result.summaries.push(summary);
  if (summary.status === "FAILED") result.failed += 1;
  else result.succeeded += 1;
}

function appendBudgetSkips(
  result: OrganizationCycleResult,
  workspaces: Array<{ organizationId: string; userId: string }>,
): void {
  for (const workspace of workspaces) {
    result.skippedBudget += 1;
    result.summaries.push({
      organizationId: workspace.organizationId,
      status: "SKIPPED_BUDGET",
    });
  }
}

function emptyResult(organizationsEligible: number): OrganizationCycleResult {
  return {
    organizationsEligible,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedBudget: 0,
    summaries: [],
  };
}

function assertBudget(budgetMs: number): void {
  if (
    !Number.isInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > MAX_OVERALL_BUDGET_MS
  ) {
    throw new Error(`overallBudgetMs must be an integer within [1, ${MAX_OVERALL_BUDGET_MS}].`);
  }
}

function createDefaultDeps(): OrganizationFetchCycleDeps {
  return {
    ensureDefaultWorkspace: (prisma) => ensureDefaultWorkspace(prisma as PrismaClient),
    listEligibleWorkerWorkspaces: (prisma) =>
      listEligibleWorkerWorkspaces(prisma as PrismaClient),
    createTaskRun: (prisma, input) => createTaskRun(prisma as PrismaClient, input),
    completeTaskRun: (prisma, taskRunId, output) =>
      completeTaskRun(prisma as PrismaClient, taskRunId, output),
    failTaskRun: (prisma, taskRunId, error) =>
      failTaskRun(prisma as PrismaClient, taskRunId, error),
    classifyTaskRunError,
    runFetchCycleForWorkspace: (prisma, workspace) =>
      runFetchCycleForWorkspace(prisma as PrismaClient, workspace),
    resetWorkspaceBudgetMs: (allocationMs) => resetCycleTimeBudget(allocationMs),
    resetOverallBudgetMs: (budgetMs) => resetCycleTimeBudget(budgetMs),
    isWorkspaceTimeExhausted: () => isCycleTimeExhausted(),
    nowFn: () => Date.now(),
  };
}
