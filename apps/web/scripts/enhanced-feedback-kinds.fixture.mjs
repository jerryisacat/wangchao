import {
  ENHANCED_FEEDBACK_KINDS,
  ENHANCED_FEEDBACK_VALUE_MAP,
  ENHANCED_FEEDBACK_KIND_ORDER,
  isValidEnhancedFeedbackKind,
  getEnhancedFeedbackValue,
  getEnhancedFeedbackOpposite,
  isOppositeEnhancedFeedbackKind,
  ENHANCED_FEEDBACK_KIND_LABEL,
} from "../src/app/actions/enhanced-feedback-kinds.ts";

// Issue #175: 详情页必须能提交全部 6 种增强反馈。
// 前置 #164：FeedbackKind 已纳入偏好学习；core preference.ts 已处理全部 6 种。
// 本 fixture 校验 web 层的白名单 / value / 撤销语义辅助函数完整。

// 1. 6 种 kind 全部被白名单接受（SOURCE_QUALITY_UP/DOWN + SCORE_UP/DOWN + MORE/LESS_LIKE_THIS）
const expectedKinds = [
  "MORE_LIKE_THIS",
  "LESS_LIKE_THIS",
  "SOURCE_QUALITY_UP",
  "SOURCE_QUALITY_DOWN",
  "SCORE_UP",
  "SCORE_DOWN",
];
for (const kind of expectedKinds) {
  if (!isValidEnhancedFeedbackKind(kind)) {
    throw new Error(`kind ${kind} should be valid (all 6 enhanced kinds must be accepted).`);
  }
}
if (ENHANCED_FEEDBACK_KINDS.length !== 6) {
  throw new Error(
    `ENHANCED_FEEDBACK_KINDS must contain exactly 6 entries, got ${ENHANCED_FEEDBACK_KINDS.length}.`,
  );
}

// 2. 每种 kind 必须有 value（防 action 提交时 valueMap 缺失 -> 写入 null -> 偏好信号丢失）
for (const kind of expectedKinds) {
  const value = getEnhancedFeedbackValue(kind);
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    throw new Error(`kind ${kind} must have a non-zero numeric value, got ${value}.`);
  }
}
// 正负方向与 SPEC §5.6 + core preference.ts 一致
const directionExpect = {
  MORE_LIKE_THIS: 1,
  LESS_LIKE_THIS: -1,
  SOURCE_QUALITY_UP: 1,
  SOURCE_QUALITY_DOWN: -1,
  SCORE_UP: 1,
  SCORE_DOWN: -1,
};
for (const [kind, sign] of Object.entries(directionExpect)) {
  const v = getEnhancedFeedbackValue(kind);
  if (Math.sign(v) !== sign) {
    throw new Error(`kind ${kind} value sign must be ${sign}, got ${v}.`);
  }
}

// 3. valueMap 与 KINDS 一致
for (const kind of ENHANCED_FEEDBACK_KINDS) {
  if (!(kind in ENHANCED_FEEDBACK_VALUE_MAP)) {
    throw new Error(`ENHANCED_FEEDBACK_VALUE_MAP missing kind ${kind}.`);
  }
}

// 4. 撤销语义：每种 kind 必须有明确的 opposite（再点反向 = 撤销/调整，DB append-only）
for (const kind of expectedKinds) {
  const opp = getEnhancedFeedbackOpposite(kind);
  if (!opp || !isValidEnhancedFeedbackKind(opp)) {
    throw new Error(`kind ${kind} must have a valid opposite, got ${opp}.`);
  }
  if (opp === kind) {
    throw new Error(`kind ${kind} opposite must not be itself.`);
  }
  // 对称
  if (getEnhancedFeedbackOpposite(opp) !== kind) {
    throw new Error(`opposite must be symmetric for ${kind}.`);
  }
  if (Math.sign(getEnhancedFeedbackValue(opp)) === Math.sign(getEnhancedFeedbackValue(kind))) {
    throw new Error(`opposite of ${kind} must have opposite value sign.`);
  }
}
// isOppositeEnhancedFeedbackKind
if (!isOppositeEnhancedFeedbackKind("SCORE_UP", "SCORE_DOWN")) {
  throw new Error("SCORE_UP / SCORE_DOWN must be opposite pair.");
}
if (!isOppositeEnhancedFeedbackKind("SOURCE_QUALITY_UP", "SOURCE_QUALITY_DOWN")) {
  throw new Error("SOURCE_QUALITY_UP / SOURCE_QUALITY_DOWN must be opposite pair.");
}
if (!isOppositeEnhancedFeedbackKind("MORE_LIKE_THIS", "LESS_LIKE_THIS")) {
  throw new Error("MORE_LIKE_THIS / LESS_LIKE_THIS must be opposite pair.");
}
if (isOppositeEnhancedFeedbackKind("SCORE_UP", "SOURCE_QUALITY_UP")) {
  throw new Error("SCORE_UP / SOURCE_QUALITY_UP must not be treated as opposite.");
}

// 5. 每种 kind 有人类可读 label（按钮 a11y + 成功 banner）
for (const kind of expectedKinds) {
  const label = ENHANCED_FEEDBACK_KIND_LABEL[kind];
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new Error(`kind ${kind} must have a non-empty label.`);
  }
}

// 6. 非法 kind 被拒绝（防注入 / 防误传 SOURCE_APPROVE 等治理类）
if (isValidEnhancedFeedbackKind("SOURCE_APPROVE")) {
  throw new Error("SOURCE_APPROVE must NOT be accepted as enhanced feedback (governance kind).");
}
if (isValidEnhancedFeedbackKind("READ")) {
  throw new Error("READ must NOT be accepted as enhanced feedback (base kind).");
}
if (isValidEnhancedFeedbackKind("FAKE_KIND")) {
  throw new Error("unknown kind must be rejected.");
}
if (isValidEnhancedFeedbackKind("")) {
  throw new Error("empty kind must be rejected.");
}

// 7. ORDER 用于详情页按钮分组渲染顺序稳定
if (ENHANCED_FEEDBACK_KIND_ORDER.length !== 6) {
  throw new Error("KIND_ORDER must list all 6 kinds.");
}

console.log("enhanced-feedback-kinds fixture OK");