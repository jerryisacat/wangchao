import {
  canonicalizeEntity,
  canonicalizeTitle,
  deterministicDedupDecision,
  recallDedupCandidates,
  selectDedupCandidatesForLlm,
  setEntityAliasOverridesForTest,
  shareCanonicalEntity,
} from "./dedup.js";

interface CandidateLike {
  eventId: string;
  title: string;
  summary: string;
  entities: string[];
  sourceId: string | null;
  sourceName: string | null;
  occurredAt: string | null;
  createdAt: string;
  status: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
  summaryStatus: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED";
  topicId: string;
}

export function runDedupFixtures(): void {
  testCanonicalTitleCollapsesSurfaceNoise();
  testCanonicalEntityCollapsesAliases();
  testShareCanonicalEntityMatchesAlias();
  testRecallIgnoresUserReadStatus();
  testRecallDoesNotIsolateByUrl();
  testRecallRespectsTopicBoundary();
  testRecallRespectsBoundedLookback();
  testDeterministicMergesSameCanonicalTitleDifferentUrl();
  testDeterministicMergesAliasEntityWithTimeWindow();
  testDeterministicDoesNotMergeDifferentTopicEvent();
  testDeterministicLateArrivingReportMergesWithinLookback();
  testLlmBudgetSelectsCanonicalMatchesFirst();
}

// ---------------------------------------------------------------------------
// canonicalizeTitle
// ---------------------------------------------------------------------------

function testCanonicalTitleCollapsesSurfaceNoise(): void {
  const a = canonicalizeTitle("【突发】OpenAI 发布 GPT-5：全新推理能力");
  const b = canonicalizeTitle("OpenAI 发布 GPT-5 全新推理能力");
  assert(
    a === b,
    `Canonical titles must collapse surface noise (brackets/punctuation). got a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
  );
  assert(a.length > 0, "Canonical title must not be empty.");
}

// internal functions exported for granular RED evidence
export const __dedupFixtureFns = {
  testCanonicalTitleCollapsesSurfaceNoise,
  testCanonicalEntityCollapsesAliases,
  testShareCanonicalEntityMatchesAlias,
  testRecallIgnoresUserReadStatus,
  testRecallDoesNotIsolateByUrl,
  testRecallRespectsTopicBoundary,
  testRecallRespectsBoundedLookback,
  testDeterministicMergesSameCanonicalTitleDifferentUrl,
  testDeterministicMergesAliasEntityWithTimeWindow,
  testDeterministicDoesNotMergeDifferentTopicEvent,
  testDeterministicLateArrivingReportMergesWithinLookback,
  testLlmBudgetSelectsCanonicalMatchesFirst,
};

// ---------------------------------------------------------------------------
// canonicalizeEntity / alias
// ---------------------------------------------------------------------------

function testCanonicalEntityCollapsesAliases(): void {
  setEntityAliasOverridesForTest({ "苹果公司": ["Apple Inc", "Apple"] });
  try {
    assert(canonicalizeEntity("Apple Inc") === "苹果公司", "Alias 'Apple Inc' must canonicalize to '苹果公司'.");
    assert(canonicalizeEntity("Apple") === "苹果公司", "Alias 'Apple' must canonicalize to '苹果公司'.");
    assert(canonicalizeEntity("苹果公司") === "苹果公司", "Canonical form must be stable.");
  } finally {
    setEntityAliasOverridesForTest(null);
  }
}

function testShareCanonicalEntityMatchesAlias(): void {
  setEntityAliasOverridesForTest({ "OpenAI": ["OpenAI Inc", "OpenAI, Inc."] });
  try {
    assert(
      shareCanonicalEntity(["OpenAI Inc"], ["OpenAI, Inc."]),
      "Alias entities must be treated as shared after canonicalization.",
    );
    assert(
      !shareCanonicalEntity(["OpenAI"], ["Anthropic"]),
      "Distinct entities must not share canonical form.",
    );
  } finally {
    setEntityAliasOverridesForTest(null);
  }
}

// ---------------------------------------------------------------------------
// recallDedupCandidates — 脱离阅读状态、不按 URL 隔绝、Topic 隔离、bounded lookback
// ---------------------------------------------------------------------------

function baseCandidate(over: Partial<CandidateLike>): CandidateLike {
  return {
    eventId: over.eventId ?? "cand-1",
    title: over.title ?? "Some event",
    summary: over.summary ?? "",
    entities: over.entities ?? [],
    sourceId: over.sourceId ?? "source-A",
    sourceName: over.sourceName ?? "Source A",
    occurredAt: over.occurredAt ?? null,
    createdAt: over.createdAt ?? "2026-07-18T00:00:00.000Z",
    status: over.status ?? "UNREAD",
    summaryStatus: over.summaryStatus ?? "READY",
    topicId: over.topicId ?? "topic-1",
  };
}

function testRecallIgnoresUserReadStatus(): void {
  const now = "2026-07-18T12:00:00.000Z";
  const recalled = recallDedupCandidates({
    newEvent: baseCandidate({ eventId: "new", topicId: "topic-1", createdAt: now, occurredAt: now, status: "UNREAD" }),
    sameTopicEvents: [
      baseCandidate({ eventId: "read-old", topicId: "topic-1", status: "READ", occurredAt: now, createdAt: now }),
      baseCandidate({ eventId: "dismissed-old", topicId: "topic-1", status: "DISMISSED", occurredAt: now, createdAt: now }),
      baseCandidate({ eventId: "unread-old", topicId: "topic-1", status: "UNREAD", occurredAt: now, createdAt: now }),
    ],
    now,
    lookbackMs: 48 * 60 * 60 * 1000,
    maxCandidates: 10,
  });
  const ids = recalled.map((c) => c.eventId).sort();
  assert(
    ids.join(",") === "dismissed-old,read-old,unread-old",
    `Recall must include READ/DISMISSED events (脱离阅读状态). got ${ids.join(",")}`,
  );
}

function testRecallDoesNotIsolateByUrl(): void {
  const now = "2026-07-18T12:00:00.000Z";
  // 同源（sourceId 相同）也应该被召回——是否合并由决策函数判断，召回层不应按 URL 隔绝。
  // 重点是不同源跨源候选不被隔绝。
  const recalled = recallDedupCandidates({
    newEvent: baseCandidate({ eventId: "new", topicId: "topic-1", sourceId: "source-A", createdAt: now, occurredAt: now }),
    sameTopicEvents: [
      baseCandidate({ eventId: "same-source", topicId: "topic-1", sourceId: "source-A" }),
      baseCandidate({ eventId: "cross-source", topicId: "topic-1", sourceId: "source-B" }),
    ],
    now,
    lookbackMs: 48 * 60 * 60 * 1000,
    maxCandidates: 10,
  });
  const ids = recalled.map((c) => c.eventId).sort();
  assert(
    ids.includes("cross-source"),
    `Recall must NOT isolate cross-source candidates by URL. got ${ids.join(",")}`,
  );
}

function testRecallRespectsTopicBoundary(): void {
  const now = "2026-07-18T12:00:00.000Z";
  const recalled = recallDedupCandidates({
    newEvent: baseCandidate({ eventId: "new", topicId: "topic-1", createdAt: now, occurredAt: now }),
    sameTopicEvents: [
      // sameTopicEvents 顾名思义只含同 topic，但若混入其它 topic 也应被过滤掉
      baseCandidate({ eventId: "other-topic", topicId: "topic-2" }),
    ],
    now,
    lookbackMs: 48 * 60 * 60 * 1000,
    maxCandidates: 10,
  });
  assert(recalled.length === 0, "Recall must never surface a different-topic event.");
}

function testRecallRespectsBoundedLookback(): void {
  const now = "2026-07-18T12:00:00.000Z";
  const recalled = recallDedupCandidates({
    newEvent: baseCandidate({ eventId: "new", topicId: "topic-1", createdAt: now, occurredAt: now }),
    sameTopicEvents: [
      baseCandidate({ eventId: "recent", topicId: "topic-1", createdAt: "2026-07-17T12:00:00.000Z" }),
      baseCandidate({ eventId: "too-old", topicId: "topic-1", createdAt: "2026-06-01T00:00:00.000Z" }),
    ],
    now,
    lookbackMs: 48 * 60 * 60 * 1000,
    maxCandidates: 10,
  });
  const ids = recalled.map((c) => c.eventId);
  assert(ids.includes("recent"), "Recent event within lookback must be recalled.");
  assert(!ids.includes("too-old"), "Event outside bounded lookback must not be recalled.");
}

// ---------------------------------------------------------------------------
// deterministicDedupDecision — 不依赖 AI 的安全 fallback
// ---------------------------------------------------------------------------

function testDeterministicMergesSameCanonicalTitleDifferentUrl(): void {
  const decision = deterministicDedupDecision(
    { title: "【独家】OpenAI 发布 GPT-5", summary: "abc", entities: ["OpenAI"], sourceId: "source-A", occurredAt: "2026-07-18T10:00:00.000Z" },
    { title: "OpenAI 发布 GPT-5", summary: "def", entities: ["OpenAI"], sourceId: "source-B", occurredAt: "2026-07-18T11:00:00.000Z" },
  );
  assert(decision.isDuplicate, `Same canonical title (different URL) must merge deterministically. reason=${decision.reason}`);
  assert(decision.confidence >= 0.8, `Canonical-title match must have high confidence. got ${decision.confidence}`);
}

function testDeterministicMergesAliasEntityWithTimeWindow(): void {
  setEntityAliasOverridesForTest({ "OpenAI": ["OpenAI Inc", "OpenAI, Inc."] });
  try {
    const decision = deterministicDedupDecision(
      { title: "OpenAI 发布新模型 o3", summary: "x", entities: ["OpenAI Inc"], sourceId: "source-A", occurredAt: "2026-07-18T10:00:00.000Z" },
      { title: "o3 模型正式亮相", summary: "y", entities: ["OpenAI, Inc."], sourceId: "source-B", occurredAt: "2026-07-18T12:00:00.000Z" },
    );
    assert(
      decision.isDuplicate,
      `Alias-entity shared within time window must merge deterministically. reason=${decision.reason}`,
    );
  } finally {
    setEntityAliasOverridesForTest(null);
  }
}

function testDeterministicDoesNotMergeDifferentTopicEvent(): void {
  // 不同 topic 在 recall 层已隔离，这里再保险：即便标题有重叠，实体不共享且时间远，不应合并。
  const decision = deterministicDedupDecision(
    { title: "苹果发布 Q3 财报", summary: "x", entities: ["苹果公司"], sourceId: "source-A", occurredAt: "2026-07-18T10:00:00.000Z" },
    { title: "苹果公司新品发布会", summary: "y", entities: ["苹果公司"], sourceId: "source-B", occurredAt: "2026-08-20T10:00:00.000Z" },
  );
  // 同实体但时间远超窗口（>24h），且 canonical title 不同，不应合并
  assert(!decision.isDuplicate, "Different occurrences sharing entity but outside time window must not merge.");
}

function testDeterministicLateArrivingReportMergesWithinLookback(): void {
  // 晚到报道：occurredAt 早（事件发生时），createdAt 晚（现在才被抓到）。
  // 只要两个事件的 occurredAt 接近，应能合并。
  const decision = deterministicDedupDecision(
    { title: "某地发生 7.0 级地震", summary: "x", entities: ["某地"], sourceId: "source-A", occurredAt: "2026-07-10T08:00:00.000Z" },
    { title: "某地强震已致多人伤亡", summary: "y", entities: ["某地"], sourceId: "source-B", occurredAt: "2026-07-10T09:00:00.000Z" },
  );
  assert(
    decision.isDuplicate,
    `Late-arriving report with close occurredAt + shared entity must merge. reason=${decision.reason}`,
  );
}

// ---------------------------------------------------------------------------
// selectDedupCandidatesForLlm — LLM 预算化：优先 canonical 命中
// ---------------------------------------------------------------------------

function testLlmBudgetSelectsCanonicalMatchesFirst(): void {
  const newEvent = { title: "OpenAI 发布 GPT-5", summary: "", entities: ["OpenAI"], sourceId: "source-A", occurredAt: "2026-07-18T10:00:00.000Z" };
  const candidates: CandidateLike[] = [
    baseCandidate({ eventId: "unrelated", title: "Anthropic 发布 Claude 4", entities: ["Anthropic"], occurredAt: "2026-07-18T10:00:00.000Z" }),
    baseCandidate({ eventId: "same-title", title: "【突发】OpenAI 发布 GPT-5", entities: ["OpenAI"], occurredAt: "2026-07-18T11:00:00.000Z" }),
    baseCandidate({ eventId: "also-unrelated", title: "谷歌发布 Gemini 3", entities: ["Google"], occurredAt: "2026-07-18T10:30:00.000Z" }),
  ];
  const selected = selectDedupCandidatesForLlm(newEvent, candidates, 1);
  assert(selected.length === 1, `Budget of 1 must select exactly one. got ${selected.length}`);
  assert(selected[0]!.eventId === "same-title", "Canonical-title match must be prioritized for LLM budget.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
