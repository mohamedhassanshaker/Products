import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  WidgetChannelRepository,
  WidgetChannelRow,
  WidgetConfigRow,
} from "../../../ports/widget-channel-repository.js";

export class PrismaWidgetChannelRepository implements WidgetChannelRepository {
  async findChannelByKind(channelKind: string): Promise<WidgetChannelRow | null> {
    const row = await getTenantDb().channel.findUnique({ where: { key: channelKind } });
    if (!row) return null;
    return {
      channelId: row.id,
      key: row.key,
      state: row.state,
      boundAgentId: row.boundAgentId,
    };
  }

  async findWidgetConfig(channelId: string): Promise<WidgetConfigRow | null> {
    const row = await getTenantDb().widgetConfig.findUnique({ where: { channelId } });
    if (!row) return null;
    return {
      accentTokenKey: row.accentTokenKey,
      launcherPosition: row.launcherPosition,
      defaultState: row.defaultState,
      disclaimerText: row.disclaimerText,
      greetingText: row.greetingText,
      composerPlaceholder: row.composerPlaceholder,
      showDisclaimerDismiss: row.showDisclaimerDismiss,
    };
  }

  async listAllowedDomains(channelId: string): Promise<readonly string[]> {
    const rows = await getTenantDb().widgetAllowedDomain.findMany({
      where: { channelId },
      select: { domain: true },
    });
    return rows.map((row) => row.domain);
  }
}
