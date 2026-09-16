/**
 * Quiet-hours arithmetic (B10 tab 4; api.md §10.3 check 4): "no sends between 21:00 and
 * 07:00 `Asia/Dubai`." Real, timezone-aware wall-clock comparison — never a hardcoded UTC
 * offset, which `tasks/lessons.md`'s own brief calls out as "a real bug class" the moment a
 * zone ever observes DST. `Asia/Dubai` itself has no DST, but this module is written to be
 * correct for any IANA zone `QuietHoursConfig.timezone`/`WorkingHoursProfile.timezone` might
 * ever hold — not special-cased to the one zone this tenant happens to use today.
 *
 * No date library is a dependency of this project (checked `package.json` before writing
 * this — no luxon/date-fns/dayjs), so this uses the standard, dependency-free technique for
 * IANA-zone arithmetic: `Intl.DateTimeFormat` with a `timeZone` option is the one built-in
 * that actually knows the IANA tz database, and comparing how it renders an instant against
 * that same instant's UTC value gives the zone's real offset at that instant — which is all
 * `Date`'s own API cannot do (`getTimezoneOffset()` only ever knows the *host's* zone).
 */

export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

export interface QuietHoursWindow {
  readonly isEnabled: boolean;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  /** IANA zone identifier, e.g. `"Asia/Dubai"`. */
  readonly timezone: string;
}

/** The zone's real UTC offset, in minutes, at the instant `date` denotes. Positive east of UTC. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - date.getTime()) / 60_000;
}

/** The zone's local wall-clock hour/minute at the instant `date` denotes. */
export function localTimeOfDay(date: Date, timeZone: string): TimeOfDay {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

/**
 * A UTC `Date` for the next wall-clock occurrence of `time` in `timeZone`, on or after
 * `now`'s local calendar date in that zone — rolling to the next day if `time` has already
 * passed today. Two-pass offset resolution (guess as UTC, re-check the offset at the
 * resulting instant, correct once more) so a target time that falls exactly on a DST
 * transition in some other zone still resolves correctly; a no-op in a fixed-offset zone
 * like `Asia/Dubai`.
 */
export function nextOccurrenceOfLocalTime(now: Date, time: TimeOfDay, timeZone: string): Date {
  const today = localCalendarDate(now, timeZone);
  let candidate = zonedTimeToUtc(today, time, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = addDays(today, 1);
    candidate = zonedTimeToUtc(tomorrow, time, timeZone);
  }
  return candidate;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
}

function localCalendarDate(date: Date, timeZone: string): CalendarDate {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? "1970"),
    month: Number(parts.find((p) => p.type === "month")?.value ?? "01"),
    day: Number(parts.find((p) => p.type === "day")?.value ?? "01"),
  };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  asUtc.setUTCDate(asUtc.getUTCDate() + days);
  return { year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate() };
}

function zonedTimeToUtc(date: CalendarDate, time: TimeOfDay, timeZone: string): Date {
  const guessUtcMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  const offsetAtGuess = timeZoneOffsetMinutes(new Date(guessUtcMs), timeZone);
  let utcMs = guessUtcMs - offsetAtGuess * 60_000;
  const offsetAtResult = timeZoneOffsetMinutes(new Date(utcMs), timeZone);
  if (offsetAtResult !== offsetAtGuess) {
    utcMs = guessUtcMs - offsetAtResult * 60_000;
  }
  return new Date(utcMs);
}

/** Whether `now` falls inside the configured quiet-hours window, in the window's own zone.
 *  Handles a window that wraps midnight (`21:00`–`07:00`) as well as one that does not. A
 *  disabled window, or a zero-length one (`startsAt === endsAt`), is never quiet. */
export function isWithinQuietHours(now: Date, window: QuietHoursWindow): boolean {
  if (!window.isEnabled) return false;

  const local = localTimeOfDay(now, window.timezone);
  const nowMinutes = local.hour * 60 + local.minute;
  const startMinutes = window.startsAt.hour * 60 + window.startsAt.minute;
  const endMinutes = window.endsAt.hour * 60 + window.endsAt.minute;

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wraps midnight: quiet from startsAt through 23:59, and again from 00:00 up to endsAt.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/** The UTC instant quiet hours next end, for re-queuing a suppressed send "to the window's
 *  end, not dropped" (api.md §10.3 check 4). Only meaningful when `isWithinQuietHours` is
 *  true for `now` — callers should check that first. */
export function quietHoursEndAfter(now: Date, window: QuietHoursWindow): Date {
  return nextOccurrenceOfLocalTime(now, window.endsAt, window.timezone);
}
