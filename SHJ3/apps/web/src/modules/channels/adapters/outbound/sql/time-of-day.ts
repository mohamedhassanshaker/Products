/**
 * SQL Server `TIME` columns (`WorkingHoursSlots.opensAt`/`closesAt`, `QuietHoursConfigs.
 * startsAt`/`endsAt`) round-trip through Prisma as a JS `Date` anchored to `1970-01-01` in
 * UTC — confirmed empirically against the real running SQL Server container while writing
 * this adapter (a throwaway probe: write a slot with a known hour/minute, read it back,
 * inspect the exact `Date` the driver returned), rather than assumed from Prisma's docs,
 * per this project's own "verify empirically at the smallest scope" discipline.
 */
import type { TimeOfDay } from "../../../domain/quiet-hours.js";

const TIME_ANCHOR_YEAR = 1970;
const TIME_ANCHOR_MONTH = 0; // January
const TIME_ANCHOR_DAY = 1;

export function toPrismaTime(time: TimeOfDay): Date {
  return new Date(
    Date.UTC(TIME_ANCHOR_YEAR, TIME_ANCHOR_MONTH, TIME_ANCHOR_DAY, time.hour, time.minute, 0),
  );
}

export function fromPrismaTime(value: Date): TimeOfDay {
  return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
}
