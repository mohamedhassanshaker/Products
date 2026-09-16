/** The real `WorkingHoursRepository` — `WorkingHoursProfiles`/`WorkingHoursSlots`/
 *  `PublicHolidays`, per-tenant (B10 tab 1's out-of-hours behaviour). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  PublicHolidayRow,
  UpdateWorkingHoursProfileInput,
  WorkingHoursProfileRow,
  WorkingHoursRepository,
  WorkingHoursSlotRow,
} from "../../../ports/working-hours-repository.js";
import { fromPrismaTime, toPrismaTime } from "./time-of-day.js";

const OPERATION = "channels working-hours repository";

export class PrismaWorkingHoursRepository implements WorkingHoursRepository {
  async find(id: string): Promise<WorkingHoursProfileRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.workingHoursProfile.findUnique({
      where: { id },
      include: { slots: { orderBy: [{ dayOfWeek: "asc" }, { opensAt: "asc" }] } },
    });
    if (!row) return null;
    const slots: readonly WorkingHoursSlotRow[] = row.slots.map((slot) => ({
      id: slot.id,
      dayOfWeek: slot.dayOfWeek,
      opensAt: fromPrismaTime(slot.opensAt),
      closesAt: fromPrismaTime(slot.closesAt),
    }));
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      publicHolidayAutoSync: row.publicHolidayAutoSync,
      assistantAvailable247: row.assistantAvailable247,
      noAgentAvailableMessage: row.noAgentAvailableMessage,
      slots,
    };
  }

  async update(input: UpdateWorkingHoursProfileInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    // The whole weekly schedule is replaced together (§1.4 hard-delete for this table) —
    // simplest correct way to reconcile "N slots in, M slots out" without a per-row diff.
    await db.$transaction([
      db.workingHoursSlot.deleteMany({ where: { workingHoursProfileId: input.id } }),
      db.workingHoursProfile.update({
        where: { id: input.id },
        data: {
          timezone: input.timezone,
          publicHolidayAutoSync: input.publicHolidayAutoSync,
          assistantAvailable247: input.assistantAvailable247,
          noAgentAvailableMessage: input.noAgentAvailableMessage,
          updatedAt: input.now,
          slots: {
            create: input.slots.map((slot) => ({
              id: newUlid(input.now),
              dayOfWeek: slot.dayOfWeek,
              opensAt: toPrismaTime(slot.opensAt),
              closesAt: toPrismaTime(slot.closesAt),
              createdAt: input.now,
              updatedAt: input.now,
            })),
          },
        },
      }),
    ]);
  }

  async listPublicHolidays(): Promise<readonly PublicHolidayRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.publicHoliday.findMany({ orderBy: { holidayDate: "asc" } });
    return rows.map((row) => ({
      id: row.id,
      holidayDate: row.holidayDate.toISOString().slice(0, 10),
      name: row.name,
      origin: row.origin as PublicHolidayRow["origin"],
      isObserved: row.isObserved,
    }));
  }
}
