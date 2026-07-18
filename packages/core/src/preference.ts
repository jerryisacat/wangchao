import { normalizeTitle } from "./hashing.js";

export interface FeedbackSignal {
  category?: string | null;
  eventId?: string | null;
  feedbackEventId?: string | null;
  kind:
    | "READ"
    | "SAVE"
    | "DISMISS"
    | "EXPORT"
    | "CATEGORY_UP"
    | "CATEGORY_DOWN"
    | "MORE_LIKE_THIS"
    | "LESS_LIKE_THIS"
    | "SOURCE_QUALITY_UP"
    | "SOURCE_QUALITY_DOWN"
    | "SCORE_UP"
    | "SCORE_DOWN";
  sourceId?: string | null;
  sourceName?: string | null;
  topicId: string;
  value?: number | null;
  createdAt?: Date | null;
}

export interface PreferenceDelta {
  confidence: number;
  explanation: string;
  key: string;
  topicId: string;
  value: {
    signalCount: number;
    weight: number;
  };
}

export interface PreferenceWeight {
  key: string;
  weight: number;
}

export function generatePreferenceDeltas(
  signals: FeedbackSignal[],
  now: Date = new Date(),
): PreferenceDelta[] {
  const processedKeys = new Set<string>();
  const grouped = new Map<
    string,
    {
      score: number;
      signalCount: number;
      topicId: string;
      type: "category" | "source";
      latestSignalAt: Date;
    }
  >();

  for (const signal of signals) {
    // Dedup by feedbackEventId (SPEC §5.6: idempotent on FeedbackEvent primary key).
    // topicId is included in the dedup key so that signals with missing
    // feedbackEventId (upstream contract violation) cannot be swallowed across
    // topics — the same kind in different topics must always remain independent.
    const dedupKey = `${signal.feedbackEventId ?? ""}::${signal.kind}::${signal.topicId}`;
    if (processedKeys.has(dedupKey)) continue;
    processedKeys.add(dedupKey);
    const weight = feedbackSignalWeight(signal);
    const keys = preferenceKeysForSignal(signal);

    for (const key of keys) {
      const groupKey = `${signal.topicId}\u0000${key}`;
      const signalTime = signal.createdAt ?? now;
      const decayedWeight = applyTimeDecay(weight, signalTime, now);
      const existing = grouped.get(groupKey) ?? {
        score: 0,
        signalCount: 0,
        topicId: signal.topicId,
        type: key.startsWith("source") ? ("source" as const) : ("category" as const),
        latestSignalAt: signalTime,
      };
      existing.score += decayedWeight;
      existing.signalCount += 1;
      if (signalTime > existing.latestSignalAt) {
        existing.latestSignalAt = signalTime;
      }
      grouped.set(groupKey, existing);
    }
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => Math.abs(group.score) >= 1)
    .map(([groupKey, group]) => {
      const key = groupKey.slice(groupKey.indexOf("\u0000") + 1);
      const normalizedWeight = Number(
        Math.max(-4, Math.min(4, group.score)).toFixed(2),
      );

      return {
        confidence: Number(
          Math.min(0.95, 0.35 + group.signalCount * 0.12).toFixed(2),
        ),
        explanation: buildPreferenceExplanation(
          group.type,
          key,
          normalizedWeight,
          group.signalCount,
        ),
        key,
        topicId: group.topicId,
        value: {
          signalCount: group.signalCount,
          weight: normalizedWeight,
        },
      };
    })
    .sort((left, right) => Math.abs(right.value.weight) - Math.abs(left.value.weight));
}

export function applyPreferenceWeights(
  baseGravityScore: number,
  keys: string[],
  weights: PreferenceWeight[],
): number {
  const totalWeight = weights
    .filter((weight) => keys.includes(weight.key))
    .reduce((sum, weight) => sum + weight.weight, 0);
  const multiplier = Math.max(0.4, Math.min(1.6, 1 + totalWeight * 0.08));

  return Number((baseGravityScore * multiplier).toFixed(4));
}

export function preferenceKeysForEvent(input: {
  category?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
}): string[] {
  const keys: string[] = [];

  if (input.category) {
    keys.push(`category:${input.category}`);
  }

  if (input.sourceId) {
    keys.push(`source:${input.sourceId}`);
  } else if (input.sourceName) {
    keys.push(`source-name:${normalizeTitle(input.sourceName)}`);
  }

  return keys;
}

function preferenceKeysForSignal(signal: FeedbackSignal): string[] {
  if (signal.kind === "CATEGORY_UP" || signal.kind === "CATEGORY_DOWN") {
    return signal.category ? [`category:${signal.category}`] : [];
  }

  if (signal.kind === "MORE_LIKE_THIS" || signal.kind === "LESS_LIKE_THIS") {
    // preferenceKeysForEvent already emits category:<cat> when category is present,
    // so we delegate entirely to it to avoid double-counting the same key.
    return preferenceKeysForEvent({
      category: signal.category,
      sourceId: signal.sourceId,
      sourceName: signal.sourceName,
    });
  }

  if (signal.kind === "SOURCE_QUALITY_UP" || signal.kind === "SOURCE_QUALITY_DOWN") {
    return preferenceKeysForEvent({
      category: null,
      sourceId: signal.sourceId,
      sourceName: signal.sourceName,
    });
  }

  if (signal.kind === "SCORE_UP" || signal.kind === "SCORE_DOWN") {
    return signal.category ? [`category:${signal.category}`] : [];
  }

  return preferenceKeysForEvent({
    category: signal.category,
    sourceId: signal.sourceId,
    sourceName: signal.sourceName,
  });
}

function feedbackSignalWeight(signal: FeedbackSignal): number {
  if (typeof signal.value === "number") {
    return Math.max(-4, Math.min(4, signal.value));
  }

  if (signal.kind === "SAVE" || signal.kind === "EXPORT") {
    return 2;
  }

  if (signal.kind === "CATEGORY_UP" || signal.kind === "MORE_LIKE_THIS") {
    return 2;
  }

  if (signal.kind === "SOURCE_QUALITY_UP") {
    return 1.5;
  }

  if (signal.kind === "SCORE_UP") {
    return 1;
  }

  if (signal.kind === "SOURCE_QUALITY_DOWN") {
    return -1.5;
  }

  if (signal.kind === "SCORE_DOWN") {
    return -1;
  }

  if (signal.kind === "READ") {
    return 0.5;
  }

  return -2;
}

const PREFERENCE_DECAY_HALF_LIFE_DAYS = 30;
const CLOCK_DRIFT_TOLERANCE_MS = 60 * 1000;

function applyTimeDecay(
  weight: number,
  signalTime: Date,
  now: Date,
): number {
  const ageMs = now.getTime() - signalTime.getTime();
  if (ageMs < -CLOCK_DRIFT_TOLERANCE_MS) {
    return 0;
  }
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  const decayFactor = Math.pow(0.5, ageDays / PREFERENCE_DECAY_HALF_LIFE_DAYS);
  return Number((weight * decayFactor).toFixed(4));
}

function buildPreferenceExplanation(
  type: "category" | "source",
  key: string,
  weight: number,
  signalCount: number,
): string {
  const direction = weight >= 0 ? "increased" : "decreased";
  const target = type === "category" ? "category" : "source";

  return `${signalCount} feedback signals ${direction} the ${target} preference for ${key}.`;
}

// ===== Issue #165: PreferenceMemory 闭环消费 =====
//
// SPEC §5.6 / §7.4：偏好学习闭环当前闭合"排序 + 摘要"两环，本任务补齐
// "抓取 + 筛选"两环。PreferenceSnapshot 是从 PreferenceMemory 推导出的
// 可解释、版本化视图：把 (key, weight) 翻译成对 filter / AI prompt /
// source scheduling 的结构化干预信号。
//
// 设计约束：
//   - 不改 schema（snapshot 是纯计算视图，不持久化；调用方每轮重新推导）。
//   - 探索率硬下限 EXPLORATION_FLOOR：任何 mute 都不能 100% 屏蔽新内容，
//     即使偏好强烈 mute 某类/某源，每轮仍有 ≥25% 概率放过，避免 filter bubble。
//   - boost 只加不减：正向偏好补充 profile 的 keywords，不会移除用户初始设置。
//   - 负向偏好与 profile excludeScope 取并集，但受 explorationRollout 门控。

/**
 * 偏好快照版本号。当推导逻辑（阈值、字段含义）发生不兼容变更时递增。
 * 调用方可据此区分新旧快照形状。
 */
export const PREFERENCE_SNAPSHOT_VERSION = 1;

/**
 * 探索率硬下限。即使用户强烈 mute 某类内容，每轮抓取/筛选仍有 ≥25%
 * 概率放过该类内容，防止不可逆 filter bubble（SPEC §5.6 风险表）。
 */
export const EXPLORATION_FLOOR = 0.25;

/**
 * 偏好进入"硬干预"（影响 filter / scheduling，而非仅排序）的权重阈值。
 * - |weight| >= PREFERENCE_HARD_THRESHOLD 才进入 snapshot 的 boosted/muted 列表。
 * - 中间区间（0 < |weight| < 阈值）只影响排序（已闭合），不进入硬干预，
 *   避免轻微反馈过度过滤。
 */
const PREFERENCE_HARD_THRESHOLD = 2;

/**
 * PreferenceMemory 的最小读取形状（与 db PreferenceMemoryRecord 对齐，
 * 但只取推导 snapshot 所需字段，便于 core 单测不依赖 db）。
 */
export interface PreferenceMemoryEntry {
  key: string;
  topicId: string;
  weight: number;
  explanation: string;
}

/**
 * 探索率门控结果。每轮调度重新掷骰：
 *   - explorationRollout=true 表示本轮"探索窗口打开"，mute 不生效。
 *   - 由 P(Math.random() < explorationAllowance) 决定。
 * 调用方可注入确定性 RNG 以便测试。
 */
export interface PreferenceExplorationRollout {
  /**
   * 是否对 mutedKeywords 生效。
   */
  muteKeywords: boolean;
  /**
   * 是否对 mutedScopes 生效。
   */
  muteScopes: boolean;
  /**
   * 是否对 mutedSources 生效（source scheduling）。
   */
  muteSources: boolean;
}

/**
 * 单个 topic 的偏好快照。可解释、版本化、幂等（给定相同 entries + RNG）。
 */
export interface PreferenceSnapshot {
  topicId: string;
  snapshotVersion: typeof PREFERENCE_SNAPSHOT_VERSION;
  /**
   * 正向偏好：补充 profile.keywords（只加不减）。
   * 来自 weight >= PREFERENCE_HARD_THRESHOLD 的 category:* key。
   */
  boostedKeywords: string[];
  /**
   * 负向偏好：与 profile.excludeScope 取并集（受 explorationRollout 门控）。
   * 来自 weight <= -PREFERENCE_HARD_THRESHOLD 的 category:* key。
   */
  mutedKeywords: string[];
  /**
   * 负向 scope：与 profile.excludeScope 取并集（受 explorationRollout 门控）。
   * 来自 weight <= -PREFERENCE_HARD_THRESHOLD 的 category:* key 中
   * 语义上是"范围"的（目前与 mutedKeywords 同源，保留独立字段以便未来
   * 区分 keyword vs scope 语义）。
   */
  mutedScopes: string[];
  /**
   * 偏好提升的信源 id 列表（source scheduling 用）。
   * 来自 weight >= PREFERENCE_HARD_THRESHOLD 的 source:* key。
   */
  preferredSources: string[];
  /**
   * 偏好降权的信源 id 列表（source scheduling 用，受 explorationRollout 门控）。
   * 来自 weight <= -PREFERENCE_HARD_THRESHOLD 的 source:* key。
   */
  mutedSources: string[];
  /**
   * 本轮探索率（受 EXPLORATION_FLOOR 约束，>= EXPLORATION_FLOOR）。
   */
  explorationAllowance: number;
  /**
   * 本轮探索门控结果。调用方据此决定是否应用 mute。
   */
  explorationRollout: PreferenceExplorationRollout;
  /**
   * 每条变更的可解释文本（用于 AI prompt 注入和审计日志）。
   */
  explanations: string[];
}

/**
 * 默认探索率：用户偏好信号不足以推导更精细策略时使用。
 * 30% 探索 —— 高于 EXPLORATION_FLOOR (25%)，给新内容足够机会。
 */
const DEFAULT_EXPLORATION_ALLOWANCE = 0.3;

export interface BuildPreferenceSnapshotOptions {
  topicId: string;
  /**
   * 本轮探索率 RNG。返回 [0,1)。默认 Math.random。
   * 注入确定性 RNG 以便测试断言 snapshot 幂等性。
   */
  random?: () => number;
  /**
   * 显式覆盖探索率（用于调度策略注入，例如夜间全量抓取时提高到 1.0）。
   * 仍受 EXPLORATION_FLOOR 约束。
   */
  explorationAllowance?: number;
}

/**
 * 从 PreferenceMemory entries 推导单个 topic 的偏好快照。
 *
 * 推导规则：
 *   - 只处理 entries.topicId === options.topicId 的条目（跨 topic 隔离，SPEC §5.6）。
 *   - category:<X> + weight >= +阈值 → boostedKeywords.push(X)
 *   - category:<X> + weight <= -阈值 → mutedKeywords.push(X) + mutedScopes.push(X)
 *   - source:<id> + weight >= +阈值 → preferredSources.push(id)
 *   - source:<id> + weight <= -阈值 → mutedSources.push(id)
 *   - source-name:* 不进入硬干预（没有稳定 id 无法调度）。
 *
 * 探索门控：对每一类 mute（keywords/scopes/sources）独立掷骰，
 *   P(打开探索窗口) = explorationAllowance。窗口打开时该类 mute 本轮不生效。
 */
export function buildPreferenceSnapshot(
  entries: PreferenceMemoryEntry[],
  options: BuildPreferenceSnapshotOptions,
): PreferenceSnapshot {
  const topicEntries = entries.filter((entry) => entry.topicId === options.topicId);
  const boostedKeywords: string[] = [];
  const mutedKeywords: string[] = [];
  const mutedScopes: string[] = [];
  const preferredSources: string[] = [];
  const mutedSources: string[] = [];
  const explanations: string[] = [];

  for (const entry of topicEntries) {
    if (entry.key.startsWith("category:")) {
      const value = entry.key.slice("category:".length);
      if (!value) continue;
      if (entry.weight >= PREFERENCE_HARD_THRESHOLD) {
        if (!boostedKeywords.includes(value)) {
          boostedKeywords.push(value);
          explanations.push(entry.explanation);
        }
      } else if (entry.weight <= -PREFERENCE_HARD_THRESHOLD) {
        if (!mutedKeywords.includes(value)) {
          mutedKeywords.push(value);
          mutedScopes.push(value);
          explanations.push(entry.explanation);
        }
      }
      continue;
    }
    if (entry.key.startsWith("source:")) {
      const value = entry.key.slice("source:".length);
      if (!value) continue;
      if (entry.weight >= PREFERENCE_HARD_THRESHOLD) {
        if (!preferredSources.includes(value)) {
          preferredSources.push(value);
          explanations.push(entry.explanation);
        }
      } else if (entry.weight <= -PREFERENCE_HARD_THRESHOLD) {
        if (!mutedSources.includes(value)) {
          mutedSources.push(value);
          explanations.push(entry.explanation);
        }
      }
    }
  }

  const explorationAllowance = Math.max(
    EXPLORATION_FLOOR,
    options.explorationAllowance ?? DEFAULT_EXPLORATION_ALLOWANCE,
  );
  const random = options.random ?? Math.random;

  const rollMute = (hasMutes: boolean): boolean => {
    if (!hasMutes) return false;
    // explorationRollout=true 表示"探索窗口打开"——本轮放过被 mute 的内容。
    return random() < explorationAllowance;
  };

  return {
    topicId: options.topicId,
    snapshotVersion: PREFERENCE_SNAPSHOT_VERSION,
    boostedKeywords,
    mutedKeywords,
    mutedScopes,
    preferredSources,
    mutedSources,
    explorationAllowance,
    explorationRollout: {
      muteKeywords: !rollMute(mutedKeywords.length > 0),
      muteScopes: !rollMute(mutedScopes.length > 0),
      muteSources: !rollMute(mutedSources.length > 0),
    },
    explanations,
  };
}

/**
 * 把 PreferenceSnapshot 翻译成给 AI event extraction 的自然语言指引。
 * 注入 system prompt，让模型感知用户当前偏好（但不强制，AI 仍按事实判断）。
 * 返回空字符串表示无偏好指引（向后兼容）。
 */
export function renderPreferenceGuidance(snapshot: PreferenceSnapshot): string {
  const lines: string[] = [];
  if (snapshot.boostedKeywords.length > 0) {
    lines.push(
      `用户当前更关注以下类别：${snapshot.boostedKeywords.join("、")}。`,
    );
  }
  if (snapshot.mutedKeywords.length > 0 && snapshot.explorationRollout.muteKeywords) {
    lines.push(
      `用户当前对以下类别反馈不感兴趣：${snapshot.mutedKeywords.join("、")}；除非有明确新事实，否则降低相关性的判断权重。`,
    );
  }
  if (snapshot.preferredSources.length > 0) {
    lines.push(
      `用户偏好以下信源：${snapshot.preferredSources.join("、")}。`,
    );
  }
  return lines.join("");
}

/**
 * Source scheduling 门控：给定 snapshot 和某个 source id，
 * 判断本轮是否抓取该 source。
 *
 * 规则：
 *   - preferredSources → 总是抓取（boost）。
 *   - mutedSources + 探索窗口关闭 → 跳过本轮（受 explorationRollout 门控）。
 *   - mutedSources + 探索窗口打开 → 仍抓取（探索）。
 *   - 其他 → 抓取（默认行为，不改变现有调度）。
 */
export function shouldFetchSource(
  snapshot: PreferenceSnapshot | null | undefined,
  sourceId: string,
): boolean {
  if (!snapshot) return true;
  if (snapshot.preferredSources.includes(sourceId)) return true;
  if (snapshot.mutedSources.includes(sourceId)) {
    return snapshot.explorationRollout.muteSources ? false : true;
  }
  return true;
}
