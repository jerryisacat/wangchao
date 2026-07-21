import type { Prisma } from "@prisma/client";
import type { DashboardEventAction, SourceGovernanceAction } from "./types.js";

export function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

export function readRuntimeEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };

  return runtime.process?.env?.[key];
}

export function readRequiredRuntimeEnv(key: string): string {
  const value = readRuntimeEnv(key);
  if (!value) {
    throw new Error(`${key} is required but not set.`);
  }
  return value;
}

export function toInputJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

export function toRequiredInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function actionToEventState(action: DashboardEventAction): {
  feedbackKind: "READ" | "SAVE" | "DISMISS" | null;
  status: "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
  value: number;
} {
  if (action === "read") {
    return { feedbackKind: "READ", status: "READ", value: 1 };
  }

  if (action === "save") {
    return { feedbackKind: "SAVE", status: "SAVED", value: 2 };
  }

  if (action === "dismiss") {
    return { feedbackKind: "DISMISS", status: "DISMISSED", value: -2 };
  }

  if (action === "archive") {
    // SPEC §5.5: archive 是个人整理动作，无偏好语义，不产生 FeedbackEvent。
    return { feedbackKind: null, status: "ARCHIVED", value: 0 };
  }

  // restore：status 由调用方按 readAt/saved 派生（不在此固定），
  // 这里给出占位 UNREAD 之外的值无意义；调用方在 updateDashboardEventState
  // 中根据现有 UserItemState 决定真实 nextStatus。此处 status 仅占位。
  return { feedbackKind: null, status: "ARCHIVED", value: 0 };
}

export function sourceActionToStatus(
  action: SourceGovernanceAction,
): "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED" {
  if (action === "approve") {
    return "ACTIVE";
  }

  if (action === "mute") {
    return "MUTED";
  }

  if (action === "reject") {
    return "REJECTED";
  }

  return "CANDIDATE";
}

// --- Source quality formula (SPEC §5.2 / §6.2) -------------------------------
// 公式版本随 evidence JSON 一起写入 SourceObservation，使历史观察可追溯、
// 旧 observation 重算时有判定基准。SPEC §6.2 只定义 trustScore/qualityScore
// 两个持久化字段；formulaVersion / 最小样本数 / 阈值都是公式常量，不入 schema。
export const SOURCE_QUALITY_FORMULA_VERSION = "v1";

// 自动治理（降权/静默）的最小样本门槛。低于此样本数只 OBSERVE，不误杀。
// SPEC §5.2「自动发现不等于自动信任」+ Issue #176 约束「小样本下不得误杀」。
export const SOURCE_QUALITY_MIN_SAMPLE = 8;

// 自动治理阈值：达到最小样本后才触发自动 MUTE。REJECT 始终保留人工确认。
export const SOURCE_GOVERNANCE_AUTO_MUTE_QUALITY = 15;
export const SOURCE_GOVERNANCE_AUTO_MUTE_NOISE = 0.55;

export function calculateSourceQualityScore(input: {
  duplicateRate: number;
  hitRate: number;
  noiseRate: number;
  trustScore: number;
}): number {
  const score =
    input.hitRate * 70 +
    input.trustScore * 10 -
    input.noiseRate * 30 -
    input.duplicateRate * 15;

  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

/**
 * 信源治理建议。
 *
 * 小样本（totalItems < SOURCE_QUALITY_MIN_SAMPLE）一律 OBSERVE，不误杀；
 * 样本足够时按 quality/noise 阈值给出 APPROVE/MUTE/REJECT 建议。
 * REJECT 是高风险状态变化，仅作为建议输出，自动治理层不会直接落到 REJECTED。
 */
export function recommendSourceStatus(
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED",
  qualityScore: number,
  totalItems: number,
  noiseRate: number,
): "APPROVE" | "OBSERVE" | "MUTE" | "REJECT" {
  if (status === "REJECTED") {
    return "REJECT";
  }

  if (totalItems === 0) {
    return status === "CANDIDATE" ? "OBSERVE" : "APPROVE";
  }

  // 小样本保护：不足以判断质量，继续观察。
  if (totalItems < SOURCE_QUALITY_MIN_SAMPLE) {
    return "OBSERVE";
  }

  if (qualityScore >= 50 && noiseRate < 0.4) {
    return "APPROVE";
  }

  if (noiseRate >= 0.75) {
    return "REJECT";
  }

  if (noiseRate >= SOURCE_GOVERNANCE_AUTO_MUTE_NOISE || qualityScore < SOURCE_GOVERNANCE_AUTO_MUTE_QUALITY) {
    return "MUTE";
  }

  return "OBSERVE";
}

/**
 * 自动治理决策：把建议转成可执行的自动状态变更。
 *
 * 规则（SPEC §5.2 + Issue #176 约束）：
 * - 只自动执行 MUTE（降权/静默），且要求达到最小样本。
 * - REJECT 始终保留人工确认，不自动落到 REJECTED。
 * - REJECTED 状态受保护，不自动复活。
 * - 已是 MUTED 的不重复降权。
 *
 * 返回 null 表示本次不自动变更（需人工或继续观察）。
 */
export function decideAutomaticGovernance(
  currentStatus: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED",
  recommendation: "APPROVE" | "OBSERVE" | "MUTE" | "REJECT",
  totalItems: number,
): { status: "MUTED"; reason: string } | null {
  // REJECTED 受保护，不自动变更。
  if (currentStatus === "REJECTED") {
    return null;
  }

  // 已 MUTED 不重复降权。
  if (currentStatus === "MUTED") {
    return null;
  }

  // 小样本不自动降权。
  if (totalItems < SOURCE_QUALITY_MIN_SAMPLE) {
    return null;
  }

  if (recommendation === "MUTE") {
    return {
      status: "MUTED",
      reason: "auto-muted-low-quality",
    };
  }

  // REJECT 保留人工确认，不自动执行。
  return null;
}

/**
 * Candidate 观察期晋升建议（SPEC §5.2 / Issue #169）。
 *
 * 与 {@link recommendSourceStatus} 的区别：前者面向已 ACTIVE 源的降权建议，
 * 本函数面向 Candidate 14 天观察期结束的晋升决策，并显式区分
 * INSUFFICIENT_SAMPLE —— 样本不足时不得 APPROVE 也不得 REJECT，必须继续观察。
 *
 * 输入来自 {@link getSourceQualitySummary}（持久化 qualityScore + 最新 observation
 * 的 hit/noise/duplicate 指标）+ Candidate 期间抓取到的 Item 总数。
 *
 * 返回值语义：
 * - `APPROVE`：质量达标，建议晋升为 ACTIVE（自动执行）。
 * - `OBSERVE`：指标模糊或刚达标，继续观察一轮（不自动变更状态，可延长窗口）。
 * - `MUTE`：噪声/重复率高，建议静默（自动执行，受 decideAutomaticGovernance 保护）。
 * - `REJECT`：明确低质，建议拒绝（**仅建议**，不自动执行，保留人工确认）。
 * - `INSUFFICIENT_SAMPLE`：样本不足（抓取失败、Item 过少、无 observation），
 *   **不得拒绝**，必须延长观察期。
 *
 * trustScore 反映 discovery 阶段的相关性；若 discovery 给出的 trustScore 本身
 * 极低（<0.2），即使样本不足也不再无限观察，但走 OBSERVE 而非 REJECT，
 * 避免误杀 discovery 误判。
 */
export function recommendCandidatePromotion(input: {
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
  qualityScore: number;
  trustScore: number;
  totalItems: number;
  hitRate: number | null;
  noiseRate: number | null;
  duplicateRate: number | null;
  stale: boolean;
  hasRecentFetchFailure?: boolean;
}): "APPROVE" | "OBSERVE" | "MUTE" | "REJECT" | "INSUFFICIENT_SAMPLE" {
  // 非 CANDIDATE 状态不走晋升路径；调用方不应把 ACTIVE/MUTED/REJECTED 源喂进来。
  // 防御性返回 OBSERVE，交由 applyAutomaticSourceGovernance / 人工处理。
  if (input.status !== "CANDIDATE") {
    return "OBSERVE";
  }

  // 抓取失败保护：近期抓取失败时不得仅凭空样本拒绝。
  if (input.hasRecentFetchFailure && input.totalItems === 0) {
    return "INSUFFICIENT_SAMPLE";
  }

  // 样本不足保护（SPEC §5.2「自动发现不等于自动信任」+ Issue #169 约束）。
  if (input.totalItems < SOURCE_QUALITY_MIN_SAMPLE) {
    return "INSUFFICIENT_SAMPLE";
  }

  // 无 observation 指标时无法判断质量，继续观察。
  if (input.hitRate === null || input.noiseRate === null) {
    return "INSUFFICIENT_SAMPLE";
  }

  // 晋升阈值：hitRate 达标、噪声和重复率可控、qualityScore 达标。
  if (
    input.hitRate >= 0.25 &&
    input.noiseRate < 0.4 &&
    input.qualityScore >= 50
  ) {
    return "APPROVE";
  }

  // 明确低质：噪声极高 + 命中极低 → 建议 REJECT（仅建议，不自动执行）。
  if (input.noiseRate >= 0.75 && input.hitRate < 0.1) {
    return "REJECT";
  }

  // 中间地带：噪声偏高或质量偏低 → 建议 MUTE（可自动执行）。
  if (
    input.noiseRate >= SOURCE_GOVERNANCE_AUTO_MUTE_NOISE ||
    input.qualityScore < SOURCE_GOVERNANCE_AUTO_MUTE_QUALITY
  ) {
    return "MUTE";
  }

  return "OBSERVE";
}

export function ratio(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Number((value / total).toFixed(4));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readObservationReason(value: unknown): string | null {
  if (!isRecord(value) || typeof value.reason !== "string") {
    return null;
  }

  return value.reason;
}

export function extractPreferenceWeight(value: unknown): number {
  if (!isRecord(value) || typeof value.weight !== "number") {
    return 0;
  }

  return value.weight;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
