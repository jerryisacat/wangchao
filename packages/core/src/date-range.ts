export interface DateRange {
  rangeEnd: Date;
  rangeStart: Date;
}

export function createUtcDayRange(value: Date): DateRange {
  const rangeStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

  return { rangeEnd, rangeStart };
}

export function createUtcWeekRange(value: Date): DateRange {
  const dayStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const dayOfWeek = dayStart.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const rangeStart = new Date(dayStart);
  rangeStart.setUTCDate(dayStart.getUTCDate() + offsetToMonday);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeStart.getUTCDate() + 7);

  return { rangeEnd, rangeStart };
}

export function createUtcMonthRange(value: Date): DateRange {
  const rangeStart = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1),
  );
  const rangeEnd = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
  );

  return { rangeEnd, rangeStart };
}
