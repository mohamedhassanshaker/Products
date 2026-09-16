/**
 * B1 tab 1's date-range control — `Today` · `Last 7 days` · `Last 30 days` — turned into
 * concrete UTC calendar dates.
 *
 * UTC, not tenant-local: `channels/domain/quiet-hours.ts` is this codebase's own
 * established precedent for "what day is it" (`Date.UTC(...)`/`getUTCFullYear()` etc.,
 * confirmed by reading that file directly rather than guessing) and
 * `ConversationMetricsDaily.metricDate`/`IntentMetricsDaily.metricDate` are both plain
 * SQL `@db.Date` columns with no timezone of their own — a UTC calendar day is the one
 * definition of "today" that both that precedent and this schema already agree on, so
 * reusing it here avoids inventing a second, competing notion of "today" for analytics
 * alone.
 */

export const DATE_RANGE_KEYS = ["Today", "Last 7 days", "Last 30 days"] as const;
export type DateRangeKey = (typeof DATE_RANGE_KEYS)[number];

const RANGE_DAY_COUNT: Readonly<Record<DateRangeKey, number>> = {
  Today: 1,
  "Last 7 days": 7,
  "Last 30 days": 30,
};

const MS_PER_DAY = 86_400_000;

/** A UTC calendar date as `YYYY-MM-DD` — matches how a `@db.Date` column round-trips
 *  through Prisma's `Date` type when only the date part is meaningful. */
export function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The `Date` at UTC midnight for a `YYYY-MM-DD` key — what gets written to a
 *  `metricDate` column. */
export function utcDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * Every UTC calendar date a range covers, oldest first, inclusive of "today" (`now`'s own
 * UTC date). `Today` is one date; `Last 7 days`/`Last 30 days` are that many consecutive
 * dates ending on today — so the three ranges are nested subsets of one 30-day window,
 * which is what lets `GetOverviewMetrics` fetch the 30-day rollup once and slice it three
 * ways instead of running three separate range queries.
 */
export function datesInRange(key: DateRangeKey, now: Date): readonly string[] {
  const dayCount = RANGE_DAY_COUNT[key];
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    keys.push(toUtcDateKey(new Date(todayUtcMs - offset * MS_PER_DAY)));
  }
  return keys;
}

/** `[startInclusive, endExclusive)` UTC instants for one calendar date — the window a
 *  rollup or a live aggregation query scopes itself to. */
export function utcDayBounds(dateKey: string): { readonly start: Date; readonly end: Date } {
  const start = utcDateFromKey(dateKey);
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}
