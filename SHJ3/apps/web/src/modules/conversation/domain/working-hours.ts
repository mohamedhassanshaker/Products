/**
 * Pure "is a human available right now" evaluation for `POST .../handover`
 * (api.md §4.2: "Outside staffed hours -> `409 handover.unavailable`" — "a
 * real time-of-day/timezone comparison, not a stub").
 *
 * Takes an already-resolved wall-clock (`nowInZone`, computed by the caller
 * via `Intl.DateTimeFormat` against the profile's IANA timezone — see
 * `request-handover.ts`) rather than a `Date` + timezone string itself, so
 * this stays a pure function with no `Intl`/environment dependency at all.
 */

export interface WorkingHoursSlotLike {
  readonly dayOfWeek: number; // 0 = Sunday
  readonly opensAt: string; // "HH:mm:ss"
  readonly closesAt: string;
}

export interface WallClockNow {
  readonly dayOfWeek: number; // 0 = Sunday, matching WorkingHoursSlot's own convention
  readonly timeOfDay: string; // "HH:mm:ss"
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * `assistantAvailable247` short-circuits to "always staffed" (the config's
 * own escape hatch for a 24/7 assistant deployment) and `isHoliday` short-
 * circuits to "never staffed" — both checked before the slot comparison.
 */
export function isCurrentlyStaffed(
  now: WallClockNow,
  slots: readonly WorkingHoursSlotLike[],
  options: { readonly assistantAvailable247: boolean; readonly isHoliday: boolean },
): boolean {
  if (options.assistantAvailable247) return true;
  if (options.isHoliday) return false;

  const nowMinutes = timeToMinutes(now.timeOfDay);
  return slots.some((slot) => {
    if (slot.dayOfWeek !== now.dayOfWeek) return false;
    const opens = timeToMinutes(slot.opensAt);
    const closes = timeToMinutes(slot.closesAt);
    return nowMinutes >= opens && nowMinutes < closes;
  });
}
