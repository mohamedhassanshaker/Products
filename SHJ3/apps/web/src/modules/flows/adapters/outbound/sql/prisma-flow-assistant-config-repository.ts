/** The real `FlowAssistantConfigRepository` — `FlowAssistantConfigs`, per-tenant singleton. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { FLOW_ASSISTANT_CONFIG_DEFAULTS } from "../../../domain/flow-assistant-config.js";
import type {
  FlowAssistantConfigRepository,
  FlowAssistantConfigRow,
  UpdateFlowAssistantConfigInput,
} from "../../../ports/flow-assistant-config-repository.js";

const OPERATION = "flow assistant config repository";

function toConfigRow(row: {
  primaryModel: string;
  fallbackModel: string | null;
  updatedByStaffUserId: string | null;
  updatedAt: Date;
}): FlowAssistantConfigRow {
  return {
    primaryModel: row.primaryModel,
    fallbackModel: row.fallbackModel,
    updatedByStaffUserId: row.updatedByStaffUserId,
    updatedAt: row.updatedAt,
  };
}

export class PrismaFlowAssistantConfigRepository implements FlowAssistantConfigRepository {
  async ensureTenantConfig(now: Date): Promise<FlowAssistantConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.flowAssistantConfig.findFirst();
    if (existing) return toConfigRow(existing);

    const d = FLOW_ASSISTANT_CONFIG_DEFAULTS;
    const created = await db.flowAssistantConfig.create({
      data: {
        id: newUlid(now),
        primaryModel: d.primaryModel,
        fallbackModel: d.fallbackModel,
        updatedByStaffUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return toConfigRow(created);
  }

  async updateTenantConfig(input: UpdateFlowAssistantConfigInput): Promise<FlowAssistantConfigRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.flowAssistantConfig.findFirstOrThrow();
    const updated = await db.flowAssistantConfig.update({
      where: { id: existing.id },
      data: {
        primaryModel: input.primaryModel,
        fallbackModel: input.fallbackModel,
        updatedByStaffUserId: input.updatedByStaffUserId,
        updatedAt: input.now,
      },
    });
    return toConfigRow(updated);
  }
}
