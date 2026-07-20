// Issue #184 (Plan Task 4.5): 业务时区窗口边界 fixture。
// TDD RED: 这些断言在 GREEN 之前必须失败。
//
// 覆盖 SPEC §4.2「可配置业务时区（organization/user 级）」：
// - DAILY/WEEKLY/MONTHLY 在指定 IANA 时区下的自然边界；
// - UTC 基线行为不退化；
// - Asia/Shanghai（UTC+8，无 DST）跨 UTC 日边界；
// - America/New_York（有 DST）跨夏令时切换的窗口稳定性；
// - 用户级 override 优先于组织级；
// - 无效时区安全回退到 UTC。

import {
  createBusinessWindowRange,
  resolveBusinessTimezone,
  type BusinessWindowPeriod,
  type BusinessWindowRange,
} from "./business-window.js";

export function runBusinessWindowFixtures(): void {
  testUtcPeriodMatchesExistingUtcDayWeekMonthBehavior();
  testUtcDayWindowIsAlignedToUtcMidnight();
  testUtcWeekWindowStartsOnMonday();
  testUtcMonthWindowSpansNaturalMonth();
  testShanghaiDailyWindowCrossesUtcDayBoundary();
  testShanghaiWeekWindowHonorsLocalMonday();
  testShanghaiMonthWindowUsesLocalCalendarMonth();
  testNewYorkDstTransitionKeepsLocalDayBoundary();
  testNewYorkFallBackTransitionDoesNotCollapseWindow();
  testUserOverrideTakesPrecedenceOverOrganization();
  testInvalidTimezoneFallsBackToUtcSafely();
}

// ─── Types ───────────────────────────────────────────────

interface BusinessTimezoneSource {
  organizationTimezone?: string | null;
  userTimezone?: string | null;
}

// ─── Tests ───────────────────────────────────────────────

function testUtcPeriodMatchesExistingUtcDayWeekMonthBehavior(): void {
  // 业务窗口在 UTC 下必须与 createUtcDayRange/Week/MonthRange 语义一致，
  // 避免引入回归（同窗口幂等键不能漂移）。
  const anchor = new Date("2026-07-20T10:30:00.000Z");

  const day = createBusinessWindowRange("DAILY", "UTC", anchor);
  assert(
    day.rangeStart.toISOString() === "2026-07-20T00:00:00.000Z" &&
      day.rangeEnd.toISOString() === "2026-07-21T00:00:00.000Z",
    `UTC DAILY 窗口必须对齐 UTC 自然日，得到 ${fmt(day)}`,
  );

  const week = createBusinessWindowRange("WEEKLY", "UTC", anchor);
  // 2026-07-20 是周一 -> 该周窗口 [07-20(周一) .. 07-27(下周一))
  assert(
    week.rangeStart.toISOString() === "2026-07-20T00:00:00.000Z" &&
      week.rangeEnd.toISOString() === "2026-07-27T00:00:00.000Z",
    `UTC WEEKLY 窗口必须从周一开始，得到 ${fmt(week)}`,
  );

  const month = createBusinessWindowRange("MONTHLY", "UTC", anchor);
  assert(
    month.rangeStart.toISOString() === "2026-07-01T00:00:00.000Z" &&
      month.rangeEnd.toISOString() === "2026-08-01T00:00:00.000Z",
    `UTC MONTHLY 窗口必须覆盖自然月，得到 ${fmt(month)}`,
  );
}

function testUtcDayWindowIsAlignedToUtcMidnight(): void {
  const anchor = new Date("2026-01-15T23:59:59.999Z");
  const win = createBusinessWindowRange("DAILY", "UTC", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-01-15T00:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-01-16T00:00:00.000Z",
    `UTC DAILY 必须对齐 UTC 午夜，得到 ${fmt(win)}`,
  );
}

function testUtcWeekWindowStartsOnMonday(): void {
  // 2026-01-04 是周日 → 前一周一是 2025-12-29
  const anchor = new Date("2026-01-04T12:00:00.000Z");
  const win = createBusinessWindowRange("WEEKLY", "UTC", anchor);
  assert(
    win.rangeStart.toISOString() === "2025-12-29T00:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-01-05T00:00:00.000Z",
    `UTC WEEKLY 必须从周一开始（周日归到上一周），得到 ${fmt(win)}`,
  );
}

function testUtcMonthWindowSpansNaturalMonth(): void {
  const anchor = new Date("2026-02-14T00:00:00.000Z");
  const win = createBusinessWindowRange("MONTHLY", "UTC", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-02-01T00:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-03-01T00:00:00.000Z",
    `UTC MONTHLY 必须跨自然月（含闰年 2 月），得到 ${fmt(win)}`,
  );
}

function testShanghaiDailyWindowCrossesUtcDayBoundary(): void {
  // Asia/Shanghai = UTC+8。当地 2026-07-20 02:00 = UTC 2026-07-19 18:00。
  // 当地自然日 07-20 → UTC 07-19T16:00 ~ 07-20T16:00。
  const anchor = new Date("2026-07-19T18:00:00.000Z"); // Shanghai 07-20 02:00
  const win = createBusinessWindowRange("DAILY", "Asia/Shanghai", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-07-19T16:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-07-20T16:00:00.000Z",
    `Shanghai DAILY 窗口必须跨 UTC 日边界（UTC+8），得到 ${fmt(win)}`,
  );
}

function testShanghaiWeekWindowHonorsLocalMonday(): void {
  // UTC 2026-07-22T16:00 = Shanghai 2026-07-23 00:00（周四）。
  // 当地所在周周一 = 2026-07-20 00:00 = UTC 2026-07-19T16:00。
  const anchor = new Date("2026-07-22T16:00:00.000Z");
  const win = createBusinessWindowRange("WEEKLY", "Asia/Shanghai", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-07-19T16:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-07-26T16:00:00.000Z",
    `Shanghai WEEKLY 必须以当地周一为起点，得到 ${fmt(win)}`,
  );
}

function testShanghaiMonthWindowUsesLocalCalendarMonth(): void {
  // UTC 2026-07-31T17:00 = Shanghai 2026-08-01 01:00（8 月）。
  // 当地自然月 = 8 月 -> [08-01 00:00, 09-01 00:00) 当地。
  //   08-01 00:00 (UTC+8) = UTC 2026-07-31T16:00
  //   09-01 00:00 (UTC+8) = UTC 2026-08-31T16:00
  const anchor = new Date("2026-07-31T17:00:00.000Z");
  const win = createBusinessWindowRange("MONTHLY", "Asia/Shanghai", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-07-31T16:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-08-31T16:00:00.000Z",
    `Shanghai MONTHLY 必须覆盖当地日历月（8 月），得到 ${fmt(win)}`,
  );
}

function testNewYorkDstTransitionKeepsLocalDayBoundary(): void {
  // America/New_York 春进夏令时 2026-03-08 02:00 → 03:00（跳过 02:xx）。
  // 当地 2026-03-08 12:00（EDT, UTC-4）= UTC 2026-03-08T16:00。
  // 当地自然日 03-08 边界：00:00 EST (UTC-5) = UTC 2026-03-08T05:00 ~ 次日 04:00。
  const anchor = new Date("2026-03-08T16:00:00.000Z"); // NY 12:00 EDT
  const win = createBusinessWindowRange("DAILY", "America/New_York", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-03-08T05:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-03-09T04:00:00.000Z",
    `NY DAILY 在 DST 切换日必须用切换前的午夜偏移（UTC-5），得到 ${fmt(win)}`,
  );
}

function testNewYorkFallBackTransitionDoesNotCollapseWindow(): void {
  // America/New_York 秋退标准时 2026-11-01 02:00 → 01:00（重复 01:xx）。
  // 当地 2026-11-01 12:00（EST, UTC-5）= UTC 2026-11-01T17:00。
  // 当地自然日边界：00:00 EDT (UTC-4) = UTC 2026-11-01T04:00 ~ 次日 05:00（EST）。
  const anchor = new Date("2026-11-01T17:00:00.000Z"); // NY 12:00 EST
  const win = createBusinessWindowRange("DAILY", "America/New_York", anchor);
  assert(
    win.rangeStart.toISOString() === "2026-11-01T04:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-11-02T05:00:00.000Z",
    `NY DAILY 在 fall-back 日窗口必须用切换前午夜的 UTC 偏移（UTC-4 起点），得到 ${fmt(win)}`,
  );
}

function testUserOverrideTakesPrecedenceOverOrganization(): void {
  // SPEC §4.2：user 级 override 优先于 org 级。
  const resolved = resolveBusinessTimezone({
    organizationTimezone: "Asia/Shanghai",
    userTimezone: "America/New_York",
  });
  assert(
    resolved === "America/New_York",
    `user override 必须优先，得到 ${resolved}`,
  );

  const onlyOrg = resolveBusinessTimezone({
    organizationTimezone: "Asia/Shanghai",
    userTimezone: null,
  });
  assert(onlyOrg === "Asia/Shanghai", `仅 org 配置时应使用 org 时区，得到 ${onlyOrg}`);

  const none = resolveBusinessTimezone({});
  assert(none === "UTC", `无配置时必须回退 UTC，得到 ${none}`);

  const invalidUser = resolveBusinessTimezone({
    organizationTimezone: "Asia/Shanghai",
    userTimezone: "Definitely/Not_A-Timezone",
  });
  assert(
    invalidUser === "Asia/Shanghai",
    `无效 user override 应被忽略并回退 org，得到 ${invalidUser}`,
  );
}

function testInvalidTimezoneFallsBackToUtcSafely(): void {
  const win = createBusinessWindowRange("DAILY", "Mars/Olympus_Mons", new Date("2026-07-20T10:00:00Z"));
  assert(
    win.rangeStart.toISOString() === "2026-07-20T00:00:00.000Z" &&
      win.rangeEnd.toISOString() === "2026-07-21T00:00:00.000Z",
    `无效时区必须安全回退到 UTC 自然日，得到 ${fmt(win)}`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

function fmt(win: BusinessWindowRange): string {
  return `[${win.rangeStart.toISOString()} .. ${win.rangeEnd.toISOString()}]`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// 显式 re-export 用于 type-only import 兜底（避免 lint 误报未使用）。
export type { BusinessWindowPeriod, BusinessWindowRange } from "./business-window.js";