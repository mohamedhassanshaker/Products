/** The real `HandoverConfigRepository` — the `HandoverConfigs` singleton, per-tenant. */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  HandoverConfigRepository,
  HandoverConfigRow,
  UpdateHandoverConfigInput,
} from "../../../ports/handover-config-repository.js";

const OPERATION = "channels handover-config repository";
const SINGLETON_KEY = 1;

export class PrismaHandoverConfigRepository implements HandoverConfigRepository {
  async getSingleton(): Promise<HandoverConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.handoverConfig.findUnique({ where: { singletonKey: SINGLETON_KEY } });
    if (!row) return null;
    return {
      id: row.id,
      workingHoursProfileId: row.workingHoursProfileId,
      noAgentAvailableMessage: row.noAgentAvailableMessage,
      offerEscalationOutsideHours: row.offerEscalationOutsideHours,
    };
  }

  async update(input: UpdateHandoverConfigInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.handoverConfig.update({
      where: { id: input.id },
      data: {
        noAgentAvailableMessage: input.noAgentAvailableMessage,
        offerEscalationOutsideHours: input.offerEscalationOutsideHours,
        updatedAt: input.now,
      },
    });
  }
}
