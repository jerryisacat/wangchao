import { normalizeTitle } from "./hashing.js";

// ---------------------------------------------------------------------------
// 去重纯函数模块 (Issue #171)
//
// 设计目标（对应 SPEC §5.4 Deduplication 阶段）：
//   1. 候选召回脱离用户阅读状态（READ/DISMISSED 仍可作为合并目标）。
//   2. canonical title/entity alias + bounded lookback + budgeted LLM compare。
//   3. 无 AI 时使用安全 deterministic fallback，不按 URL 隔绝跨源候选。
//   4. 不同 Topic 不误合并（recall 层 topicId 隔离）。
//   5. 来源完整保留（实际保留由 mergeSemanticEvents 承载，这里只做决策）。
//
// 本模块不依赖 Prisma / AI adapter，可 hermetic 测试。
// ---------------------------------------------------------------------------

const DEFAULT_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 内置实体别名表
// key = canonical 形式，value = 所有需要归一到该 canonical 的别名（含 key 自身的无意义重复由归一函数处理）
// ---------------------------------------------------------------------------

const BUILTIN_ENTITY_ALIASES: Record<string, string[]> = {
  "苹果公司": ["Apple Inc", "Apple Inc.", "Apple, Inc.", "Apple"],
  "微软": ["Microsoft", "Microsoft Corp", "Microsoft Corporation"],
  "谷歌": ["Google", "Google LLC", "Alphabet"],
  "OpenAI": ["OpenAI Inc", "OpenAI, Inc.", "OpenAI Inc."],
  "Meta": ["Meta Platforms", "Facebook", "Facebook Inc"],
  "Anthropic": ["Anthropic PBC", "Anthropic Inc"],
  "英伟达": ["NVIDIA", "Nvidia", "NVIDIA Corporation"],
  "特斯拉": ["Tesla", "Tesla Inc", "Tesla, Inc."],
  "亚马逊": ["Amazon", "Amazon.com", "Amazon.com, Inc."],
  "字节跳动": ["ByteDance", "ByteDance Ltd."],
  "腾讯": ["Tencent", "Tencent Holdings"],
  "阿里巴巴": ["Alibaba", "Alibaba Group", "Alibaba Group Holding"],
};

let entityAliasOverrides: Record<string, string[]> | null = null;

/**
 * 测试专用：临时覆盖别名表。传 null 恢复内置表。
 * 不在生产路径调用。
 */
export function setEntityAliasOverridesForTest(overrides: Record<string, string[]> | null): void {
  entityAliasOverrides = overrides;
}

function getActiveAliasTable(): Record<string, string[]> {
  return entityAliasOverrides ?? BUILTIN_ENTITY_ALIASES;
}

// ---------------------------------------------------------------------------
// canonicalizeTitle
// ---------------------------------------------------------------------------

/**
 * 标题归一化，用于跨源同一事件匹配。
 * 在 normalizeTitle（NFC + lowercase + 折叠空白）基础上：
 *   - 去掉常见前缀噪声：【突发】、【独家】、|、-、：、破折号引导的子标题
 *   - 去掉所有标点符号（中英文），只保留字母/数字/中文/空白
 *   - 折叠空白
 * 不同 URL/标题但描述同一事件时，canonical title 应相等。
 */
export function canonicalizeTitle(title: string): string {
  let s = title.normalize("NFC");
  // 去掉常见前缀括号注释：开头的【...】、『...』、[...]、"..."
  s = s.replace(/^[\s]*[【《「『\[“][^\]】》」』”]*[\]】》」』”][\s]*/g, "");
  // 全角转半角（常见标点）
  s = s.replace(/[：]/g, ":").replace(/[，]/g, ",").replace(/[。]/g, ".").replace(/[！]/g, "!").replace(/[？]/g, "?");
  // 去掉 | - – - 引导的尾部副标题（保留前半部分）
  s = s.replace(/\s*[｜|-–-]\s*.*$/g, "");
  // 去掉所有标点（保留字母数字中文空白），冒号等分隔符一律移除，使不同写法归一
  s = s.replace(/[^\p{L}\p{N}\s]/gu, "");
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  return s;
}

// ---------------------------------------------------------------------------
// canonicalizeEntity
// ---------------------------------------------------------------------------

/**
 * 实体归一化：大小写折叠 + 全角半角统一 + 别名表查找。
 * 不命中别名表的实体原样返回（经基础归一化），保证不误合并。
 */
export function canonicalizeEntity(entity: string): string {
  let s = entity.normalize("NFC").trim();
  if (s.length === 0) return "";
  // 全角转半角
  s = s.replace(/[：]/g, ":").replace(/[，]/g, ",").replace(/[。]/g, ".");
  // 去掉尾部 Inc. / Inc / Corp. / Corporation / Ltd. / Ltd 等法人后缀做别名匹配的 key
  const stripped = s
    .replace(/[,\s]+(Inc|Inc\.|Corp|Corp\.|Corporation|Ltd|Ltd\.|LLC|PBC)\.?$/i, "")
    .trim();
  const lookupKey = stripped;
  // 在别名表中查找
  const table = getActiveAliasTable();
  for (const [canonical, aliases] of Object.entries(table)) {
    if (lookupKey.toLowerCase() === canonical.toLowerCase()) return canonical;
    for (const alias of aliases) {
      if (lookupKey.toLowerCase() === alias.toLowerCase()) return canonical;
    }
  }
  // 未命中：返回去掉法人后缀的归一化形式（保留大小写以区分）
  return lookupKey || s;
}

/**
 * 两个事件是否共享任一 canonical 实体。
 * 空实体数组视为"无信号"，返回 false（不作为合并依据）。
 */
export function shareCanonicalEntity(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set(a.map(canonicalizeEntity).filter((e) => e.length > 0));
  for (const entity of b) {
    const c = canonicalizeEntity(entity);
    if (c.length > 0 && setA.has(c)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 类型：去重候选与决策
// ---------------------------------------------------------------------------

export interface DedupEventLite {
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

export interface RecallDedupCandidatesInput {
  newEvent: DedupEventLite;
  sameTopicEvents: DedupEventLite[];
  now: string;
  lookbackMs: number;
  maxCandidates: number;
}

/**
 * 候选召回：脱离用户阅读状态、不按 URL/sourceId 隔绝、Topic 隔离、bounded lookback。
 * 返回按 createdAt 升序的候选列表（不含 newEvent 自身，不含 ARCHIVED，只含 summaryStatus=READY）。
 */
export function recallDedupCandidates(input: RecallDedupCandidatesInput): DedupEventLite[] {
  const nowMs = new Date(input.now).getTime();
  const lookbackStart = nowMs - input.lookbackMs;
  const newId = input.newEvent.eventId;
  const newTopic = input.newEvent.topicId;

  const recalled: DedupEventLite[] = [];
  for (const event of input.sameTopicEvents) {
    if (event.eventId === newId) continue;
    if (event.topicId !== newTopic) continue; // 不同 Topic 不误合并
    if (event.status === "ARCHIVED") continue; // 已归档（被合并过）不召回
    if (event.summaryStatus !== "READY") continue; // 摘要未就绪不参与去重
    // bounded lookback：基于 createdAt（事件进入系统的时间），而非 occurredAt
    // 这样晚到报道（occurredAt 早但 createdAt 晚）也能被召回
    const createdMs = new Date(event.createdAt).getTime();
    if (!Number.isFinite(createdMs) || createdMs < lookbackStart) continue;
    recalled.push(event);
  }

  // 按 createdAt 升序（旧->新），保证先比较更早的候选
  recalled.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return recalled.slice(0, Math.max(0, input.maxCandidates));
}

// ---------------------------------------------------------------------------
// deterministicDedupDecision - 无 AI 时的安全 fallback
// ---------------------------------------------------------------------------

export interface DedupDecision {
  isDuplicate: boolean;
  confidence: number;
  reason: string;
}

export interface DedupEventForDecision {
  title: string;
  summary: string;
  entities: string[];
  sourceId: string | null;
  occurredAt: string | null;
}

/**
 * 安全 deterministic 去重决策（无 AI 时使用）。
 * 规则：
 *   1. canonical title 完全相同 + 时间窗（occurredAt 相差 <=24h 或都缺失）-> 高置信度合并（0.9）。
 *   2. 共享 canonical entity + 时间窗 -> 中置信度合并（0.75）。
 *   3. 否则不合并。
 * 永不基于 URL/sourceId 隔绝跨源候选。
 */
export function deterministicDedupDecision(
  newEvent: DedupEventForDecision,
  candidate: DedupEventForDecision,
): DedupDecision {
  const withinTimeWindow = withinOccurredAtWindow(newEvent.occurredAt, candidate.occurredAt, DEFAULT_TIME_WINDOW_MS);

  // 规则 1：canonical title 完全相同
  const newCanonical = canonicalizeTitle(newEvent.title);
  const candCanonical = canonicalizeTitle(candidate.title);
  if (newCanonical.length > 0 && newCanonical === candCanonical) {
    if (withinTimeWindow) {
      return {
        isDuplicate: true,
        confidence: 0.9,
        reason: `确定性去重：标题归一化匹配（${newCanonical}），时间窗内`,
      };
    }
    // canonical title 相同但时间窗外：仍可能是同一事件重复报道（晚到报道），降低置信度
    return {
      isDuplicate: true,
      confidence: 0.8,
      reason: `确定性去重：标题归一化匹配（${newCanonical}），时间窗外但可能是晚到报道`,
    };
  }

  // 规则 2：共享 canonical entity + 时间窗
  if (withinTimeWindow && shareCanonicalEntity(newEvent.entities, candidate.entities)) {
    return {
      isDuplicate: true,
      confidence: 0.75,
      reason: "确定性去重：共享实体别名且时间窗内",
    };
  }

  return { isDuplicate: false, confidence: 0, reason: "确定性去重：无标题归一化匹配且无共享实体别名" };
}

function withinOccurredAtWindow(a: string | null, b: string | null, windowMs: number): boolean {
  if (!a || !b) return true; // 任一缺失时间，保守视为窗内（不阻塞合并）
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) <= windowMs;
}

// ---------------------------------------------------------------------------
// selectDedupCandidatesForLlm - LLM 预算化选择
// ---------------------------------------------------------------------------

/**
 * 从召回集中挑选送给 LLM 的子集（预算化）。
 * 优先级：
 *   1. canonical title 相同的候选（最强信号）。
 *   2. 共享 canonical entity 的候选。
 *   3. 其余候选（按 createdAt 接近度）。
 * 返回最多 maxForLlm 个候选。
 */
export function selectDedupCandidatesForLlm(
  newEvent: DedupEventForDecision,
  candidates: DedupEventLite[],
  maxForLlm: number,
): DedupEventLite[] {
  if (maxForLlm <= 0) return [];
  const newCanonical = canonicalizeTitle(newEvent.title);

  const scored = candidates.map((c) => {
    const candCanonical = canonicalizeTitle(c.title);
    let score = 0;
    if (newCanonical.length > 0 && newCanonical === candCanonical) score += 100;
    if (shareCanonicalEntity(newEvent.entities, c.entities)) score += 50;
    // createdAt 越接近 newEvent 越优先（晚到报道更可能是同一事件）
    if (newEvent.occurredAt && c.occurredAt) {
      const diff = Math.abs(new Date(newEvent.occurredAt).getTime() - new Date(c.occurredAt).getTime());
      if (Number.isFinite(diff)) score += Math.max(0, 10 - Math.floor(diff / (60 * 60 * 1000))); // 每小时差扣 1 分，最多 +10
    }
    return { candidate: c, score };
  });

  scored.sort((a, b) => b.score - a.score || new Date(a.candidate.createdAt).getTime() - new Date(b.candidate.createdAt).getTime());

  return scored.slice(0, maxForLlm).map((s) => s.candidate);
}

// 暴露默认窗口常量供 worker 复用
export const DEDUP_TIME_WINDOW_MS = DEFAULT_TIME_WINDOW_MS;

// 保留 normalizeTitle 引用以避免未使用导入（canonicalizeTitle 内部逻辑独立实现，但 normalizeTitle 用于未来扩展）
void normalizeTitle;
