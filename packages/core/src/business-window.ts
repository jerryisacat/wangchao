// Issue #184 (Plan Task 4.5) — SPEC §4.2 可配置业务时区。
//
// 设计：
// - 不改 Prisma schema（约束：本轮不做 migration）。时区来源由调用方
//   从 Organization/User 现有字段或 metadata JSON 读取后传入
//   resolveBusinessTimezone；本模块只做纯计算。
// - 窗口边界用 Intl.DateTimeFormat 把锚点投影到目标时区的本地年/月/日，
//   再把本地午夜的 wall-clock 通过格式化逆解析回 UTC。这依赖 JS 引擎
//   内置的 IANA tzdata（Node 内置 ICU），自动处理 DST，无需外部依赖。
// - 周窗口以当地周一为起点（与现有 UTC 实现保持一致）。
// - 幂等键仍基于 rangeStart/rangeEnd 的 UTC 毫秒（Briefing @@unique
//   [topicId, period, rangeStart]），业务窗口只改变 rangeStart 的语义，
//   不改键的唯一性约束。

export type BusinessWindowPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

export interface BusinessWindowRange {
  rangeEnd: Date;
  rangeStart: Date;
}

export interface BusinessTimezoneSource {
  organizationTimezone?: string | null;
  userTimezone?: string | null;
}

const DEFAULT_TIMEZONE = "UTC";
const UNSPECIFIED_REASON = "unspecified";

// ─── 时区解析 ─────────────────────────────────────────────

/**
 * 按 SPEC §4.2 解析生效业务时区：user override > organization > UTC。
 * 无效时区（Intl 抛错）逐级回退，最终回退 UTC。
 */
export function resolveBusinessTimezone(source: BusinessTimezoneSource): string {
  if (source.userTimezone && isValidTimezone(source.userTimezone)) {
    return source.userTimezone;
  }
  if (source.organizationTimezone && isValidTimezone(source.organizationTimezone)) {
    return source.organizationTimezone;
  }
  return DEFAULT_TIMEZONE;
}

function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.trim() === "") return false;
  try {
    // Intl.DateTimeFormat 在无效 tz 上会抛 RangeError；触发一次格式化验证。
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "short" });
    return true;
  } catch {
    return false;
  }
}

// ─── 本地投影 helpers ─────────────────────────────────────

interface LocalCalendar {
  day: number;
  dayOfWeek: number; // 0=Sun .. 6=Sat（本地）
  month: number; // 0-indexed
  year: number;
}

function toLocalCalendar(anchor: Date, timezone: string): LocalCalendar {
  const fmt = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
  });
  const parts = fmt.formatToParts(anchor);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = Number(get("day"));
  const month = Number(get("month")) - 1;
  const year = Number(get("year"));
  const weekdayStr = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
  return { day, dayOfWeek, month, year };
}

/**
 * 把 (目标时区本地年月日 00:00:00) 反解为 UTC Date。
 *
 * 策略：先用 UTC 正午估算偏移，得到候选 UTC 午夜；再用候选时刻
 * 自身的 Intl 偏移做一次修正。这一步是必须的，因为 DST 切换日的
 * 午夜偏移与同日正午偏移可能不同（例如春进夏令时日：00:00 EST
 * 但 12:00 EDT）。两次逼近足以收敛到正确边界（ICU 偏移在一天内
 * 最多跳变一次，单次迭代即可消除符号差异）。
 */
function localMidnightToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
): Date {
  if (timezone === DEFAULT_TIMEZONE) {
    return new Date(Date.UTC(year, month, day));
  }
  // 第一次估算：用 UTC 正午取偏移。
  const utcNoon = new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
  const offsetAtNoon = offsetMinutesAt(utcNoon, timezone);
  const candidate = new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0) - offsetAtNoon * 60_000,
  );
  // 修正：用候选时刻自身的偏移重算。若候选落在 DST 跳变另一侧，
  // 其偏移与正午不同，重算后即落到正确一侧。
  const offsetAtCandidate = offsetMinutesAt(candidate, timezone);
  // 只在偏移真的不同时才修正，避免无谓抖动。
  if (offsetAtCandidate === offsetAtNoon) {
    return candidate;
  }
  return new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0) - offsetAtCandidate * 60_000,
  );
}

/**
 * 给定 UTC 时刻和 tz，返回该时刻的 UTC 偏移（分钟）。
 * 东八区返回 +480，西五区返回 -300。
 */
function offsetMinutesAt(utc: Date, timezone: string): number {
  if (timezone === DEFAULT_TIMEZONE) return 0;
  // 用 Intl 取本地 wall-clock，与 UTC wall-clock 相减。
  const localFmt = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = localFmt.formatToParts(utc);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const ly = get("year");
  const lMo = get("month") - 1;
  const lD = get("day");
  let lH = get("hour");
  if (lH === 24) lH = 0; // 某些 ICU 版本返回 24
  const lMi = get("minute");
  const lS = get("second");
  const localMs = Date.UTC(ly, lMo, lD, lH, lMi, lS);
  const utcMs = utc.getTime();
  // local wall-clock 在 UTC 之上的偏移 = localMs(伪 UTC) - actualUtcMs
  return Math.round((localMs - utcMs) / 60_000);
}

// ─── 窗口构造 ─────────────────────────────────────────────

/**
 * 在指定业务时区下计算 DAILY/WEEKLY/MONTHLY 窗口的 [rangeStart, rangeEnd)。
 * rangeStart/rangeEnd 始终是 UTC Date（Briefing 唯一键用 UTC 毫秒）。
 * 无效时区安全回退 UTC。
 *
 * 关键：rangeEnd 由「目标本地日的下一边界」反解得到，而不是
 * rangeStart + 固定毫秒。这样 DST 切换日（当地日长 23 或 25 小时）
 * 的窗口长度由引擎决定，我们不做算术近似。
 */
export function createBusinessWindowRange(
  period: BusinessWindowPeriod,
  timezone: string,
  anchor: Date,
): BusinessWindowRange {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const cal = toLocalCalendar(anchor, tz);

  if (period === "DAILY") {
    const rangeStart = localMidnightToUtc(tz, cal.year, cal.month, cal.day);
    const next = shiftLocalDate(cal, 1);
    const rangeEnd = localMidnightToUtc(tz, next.year, next.month, next.day);
    return { rangeEnd, rangeStart };
  }

  if (period === "WEEKLY") {
    // 周一为起点：0=Sun -> offset -6, 1=Mon -> 0, 2=Tue -> -1 ...
    const offsetToMonday = cal.dayOfWeek === 0 ? -6 : 1 - cal.dayOfWeek;
    const startCal = shiftLocalDate(cal, offsetToMonday);
    const rangeStart = localMidnightToUtc(tz, startCal.year, startCal.month, startCal.day);
    const endCal = shiftLocalDate(startCal, 7);
    const rangeEnd = localMidnightToUtc(tz, endCal.year, endCal.month, endCal.day);
    return { rangeEnd, rangeStart };
  }

  // MONTHLY
  const rangeStart = localMidnightToUtc(tz, cal.year, cal.month, 1);
  const nextMonth = normalizeMonth(cal.year, cal.month + 1);
  const rangeEnd = localMidnightToUtc(tz, nextMonth.year, nextMonth.month, 1);
  return { rangeEnd, rangeStart };
}

function shiftLocalDate(cal: LocalCalendar, deltaDays: number): LocalCalendar {
  const base = new Date(Date.UTC(cal.year, cal.month, cal.day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return {
    day: base.getUTCDate(),
    dayOfWeek: base.getUTCDay(),
    month: base.getUTCMonth(),
    year: base.getUTCFullYear(),
  };
}

function normalizeMonth(year: number, month: number): { year: number; month: number } {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return { month: m, year: y };
}

// re-export to keep filtered-stats internal symbol命名一致
export { UNSPECIFIED_REASON };