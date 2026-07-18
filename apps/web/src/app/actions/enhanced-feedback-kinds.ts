// Issue #175: 增强反馈 web 层纯函数。
// 复用 #164 的 FeedbackKind 与 core preference.ts 的 value/direction 语义。
// 抽出为纯函数以便 fixture 测试（server action 无法 hermetic 测）。

export type EnhancedFeedbackKind =
  | "MORE_LIKE_THIS"
  | "LESS_LIKE_THIS"
  | "SOURCE_QUALITY_UP"
  | "SOURCE_QUALITY_DOWN"
  | "SCORE_UP"
  | "SCORE_DOWN";

// SPEC §5.6: 6 种增强反馈（不含 READ/SAVE/DISMISS/EXPORT/SOURCE_APPROVE/CATEGORY_*）。
export const ENHANCED_FEEDBACK_KIND_ORDER: readonly EnhancedFeedbackKind[] = [
  "MORE_LIKE_THIS",
  "LESS_LIKE_THIS",
  "SOURCE_QUALITY_UP",
  "SOURCE_QUALITY_DOWN",
  "SCORE_UP",
  "SCORE_DOWN",
];

export const ENHANCED_FEEDBACK_KINDS: readonly EnhancedFeedbackKind[] =
  ENHANCED_FEEDBACK_KIND_ORDER;

// value 与 core preference.ts signValueForSignal / weightForSignal 一致方向：
// 正向 = 提升权重，负向 = 降低权重。具体量级沿用 events.ts 旧 valueMap，保持兼容。
export const ENHANCED_FEEDBACK_VALUE_MAP: Record<EnhancedFeedbackKind, number> = {
  MORE_LIKE_THIS: 2,
  LESS_LIKE_THIS: -2,
  SOURCE_QUALITY_UP: 1.5,
  SOURCE_QUALITY_DOWN: -1.5,
  SCORE_UP: 1,
  SCORE_DOWN: -1,
};

// 撤销语义：再点反向 = 提交对冲信号（DB append-only，偏好学习会净额）。
export const ENHANCED_FEEDBACK_OPPOSITE: Record<EnhancedFeedbackKind, EnhancedFeedbackKind> = {
  MORE_LIKE_THIS: "LESS_LIKE_THIS",
  LESS_LIKE_THIS: "MORE_LIKE_THIS",
  SOURCE_QUALITY_UP: "SOURCE_QUALITY_DOWN",
  SOURCE_QUALITY_DOWN: "SOURCE_QUALITY_UP",
  SCORE_UP: "SCORE_DOWN",
  SCORE_DOWN: "SCORE_UP",
};

// 按钮文字 + a11y label。SCORE 类语义=校准系统评分，SOURCE_QUALITY 类=评价来源质量。
export const ENHANCED_FEEDBACK_KIND_LABEL: Record<EnhancedFeedbackKind, string> = {
  MORE_LIKE_THIS: "多看类似",
  LESS_LIKE_THIS: "少看类似",
  SOURCE_QUALITY_UP: "来源靠谱",
  SOURCE_QUALITY_DOWN: "来源存疑",
  SCORE_UP: "评分偏低",
  SCORE_DOWN: "评分偏高",
};

export function isValidEnhancedFeedbackKind(value: unknown): value is EnhancedFeedbackKind {
  return (
    typeof value === "string" &&
    (ENHANCED_FEEDBACK_KINDS as readonly string[]).includes(value)
  );
}

export function getEnhancedFeedbackValue(kind: EnhancedFeedbackKind): number {
  return ENHANCED_FEEDBACK_VALUE_MAP[kind];
}

export function getEnhancedFeedbackOpposite(
  kind: EnhancedFeedbackKind,
): EnhancedFeedbackKind {
  return ENHANCED_FEEDBACK_OPPOSITE[kind];
}

export function isOppositeEnhancedFeedbackKind(
  a: EnhancedFeedbackKind,
  b: EnhancedFeedbackKind,
): boolean {
  return getEnhancedFeedbackOpposite(a) === b;
}

// 用于 action 层：SCORE 类需同时写 category preference（沿用旧 recordCategoryPreferenceFeedback 路径），
// SOURCE_QUALITY 类只影响 source 权重（core preference.ts 已在 preferenceKeysForEvent 处理），不调 category feedback。
export function shouldRecordCategoryPreference(
  kind: EnhancedFeedbackKind,
): boolean {
  return kind === "SCORE_UP" || kind === "SCORE_DOWN";
}