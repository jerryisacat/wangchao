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
