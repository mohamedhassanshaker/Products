import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  HandoverRoutingConfigRepository,
  HandoverRoutingConfigRow,
} from "../../../ports/handover-routing-config-repository.js";

export class PrismaHandoverRoutingConfigRepository implements HandoverRoutingConfigRepository {
  async getSingleton(): Promise<HandoverRoutingConfigRow | null> {
    const row = await getTenantDb("handover routing config").handoverConfig.findUnique({
      where: { singletonKey: 1 },
    });
    return row
      ? {
          defaultQueueTeamId: row.defaultQueueTeamId,
          maxWaitSecondsBeforeRequeue: row.maxWaitSecondsBeforeRequeue,
          supervisorAlertTeamId: row.supervisorAlertTeamId,
        }
      : null;
  }
}
