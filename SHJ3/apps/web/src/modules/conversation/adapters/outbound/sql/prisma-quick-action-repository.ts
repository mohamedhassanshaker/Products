import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  QuickActionRepository,
  QuickActionRow,
} from "../../../ports/quick-action-repository.js";

export class PrismaQuickActionRepository implements QuickActionRepository {
  async listForChannel(
    channelKind: string,
    localeCode: string,
  ): Promise<readonly QuickActionRow[]> {
    const rows = await getTenantDb().quickAction.findMany({
      where: {
        localeCode,
        isEnabled: true,
        channelScope: { in: ["All", channelKind] },
      },
      orderBy: { ordinal: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      payloadIntentKey: row.payloadIntentKey,
      ordinal: row.ordinal,
    }));
  }
}
