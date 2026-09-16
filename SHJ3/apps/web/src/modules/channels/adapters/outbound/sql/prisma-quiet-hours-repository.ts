/** The real `QuietHoursRepository` — the `QuietHoursConfigs` singleton, per-tenant (B10 tab 4). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  QuietHoursConfigRow,
  QuietHoursRepository,
  UpdateQuietHoursInput,
} from "../../../ports/quiet-hours-repository.js";
import { fromPrismaTime, toPrismaTime } from "./time-of-day.js";

const OPERATION = "channels quiet-hours repository";
const SINGLETON_KEY = 1;

export class PrismaQuietHoursRepository implements QuietHoursRepository {
  async getSingleton(): Promise<QuietHoursConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.quietHoursConfig.findUnique({ where: { singletonKey: SINGLETON_KEY } });
    if (!row) return null;
    return {
      id: row.id,
      isEnabled: row.isEnabled,
      startsAt: fromPrismaTime(row.startsAt),
      endsAt: fromPrismaTime(row.endsAt),
      timezone: row.timezone,
    };
  }

  async update(input: UpdateQuietHoursInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.quietHoursConfig.update({
      where: { singletonKey: SINGLETON_KEY },
      data: {
        isEnabled: input.isEnabled,
        startsAt: toPrismaTime(input.startsAt),
        endsAt: toPrismaTime(input.endsAt),
        timezone: input.timezone,
        updatedAt: input.now,
      },
    });
  }
}
