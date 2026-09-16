/** The real `WidgetConfigRepository` — `WidgetConfigs`/`WidgetAllowedDomains`, per-tenant
 *  (B10 tab 2). */
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { LauncherPosition, WidgetDefaultState } from "../../../domain/vocabulary.js";
import type {
  CreateDefaultWidgetConfigInput,
  UpdateWidgetConfigInput,
  WidgetAllowedDomainRow,
  WidgetConfigRepository,
  WidgetConfigRow,
} from "../../../ports/widget-config-repository.js";

const OPERATION = "channels widget-config repository";

function toWidgetConfigRow(row: {
  id: string;
  channelId: string;
  accentTokenKey: string;
  launcherPosition: string;
  defaultState: string;
  disclaimerText: string;
  greetingText: string;
  composerPlaceholder: string;
  showDisclaimerDismiss: boolean;
  embedSnippetVersion: number;
}): WidgetConfigRow {
  return {
    id: row.id,
    channelId: row.channelId,
    accentTokenKey: row.accentTokenKey,
    launcherPosition: row.launcherPosition as LauncherPosition,
    defaultState: row.defaultState as WidgetDefaultState,
    disclaimerText: row.disclaimerText,
    greetingText: row.greetingText,
    composerPlaceholder: row.composerPlaceholder,
    showDisclaimerDismiss: row.showDisclaimerDismiss,
    embedSnippetVersion: row.embedSnippetVersion,
  };
}

export class PrismaWidgetConfigRepository implements WidgetConfigRepository {
  async findByChannelId(channelId: string): Promise<WidgetConfigRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.widgetConfig.findUnique({ where: { channelId } });
    return row ? toWidgetConfigRow(row) : null;
  }

  async update(input: UpdateWidgetConfigInput): Promise<WidgetConfigRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.widgetConfig.update({
      where: { channelId: input.channelId },
      data: {
        accentTokenKey: input.accentTokenKey,
        launcherPosition: input.launcherPosition,
        defaultState: input.defaultState,
        disclaimerText: input.disclaimerText,
        greetingText: input.greetingText,
        composerPlaceholder: input.composerPlaceholder,
        showDisclaimerDismiss: input.showDisclaimerDismiss,
        // "PUT returns the recomputed embed snippet, so the live preview and the snippet
        // cannot disagree" (api.md §6.9) — bumping the version on every save is what makes
        // the snippet a function of "what was actually saved" rather than a value that could
        // silently drift from it.
        embedSnippetVersion: { increment: 1 },
        updatedAt: input.now,
      },
    });
    return toWidgetConfigRow(row);
  }

  async createDefault(input: CreateDefaultWidgetConfigInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.widgetConfig.create({
      data: {
        id: newUlid(input.now),
        channelId: input.channelId,
        // The design token behind the wireframe's #1F6F5C default swatch — never the hex
        // literal itself (CK_WidgetConfigs_accentIsToken).
        accentTokenKey: "--chart-1",
        launcherPosition: "BottomRight",
        defaultState: "Docked",
        disclaimerText: "This assistant can make mistakes. Verify important information.",
        greetingText: "Hi! I'm your SHJ3 Assistant. How can I help you today?",
        composerPlaceholder: "Ask SHJ3 Assistant",
        showDisclaimerDismiss: true,
        embedSnippetVersion: 1,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  async listAllowedDomains(channelId: string): Promise<readonly WidgetAllowedDomainRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.widgetAllowedDomain.findMany({
      where: { channelId },
      orderBy: { domain: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      addedByStaffUserId: row.addedByStaffUserId,
      addedAt: row.addedAt,
    }));
  }

  async addAllowedDomain(input: {
    readonly channelId: string;
    readonly domain: string;
    readonly addedByStaffUserId: string;
    readonly now: Date;
  }): Promise<WidgetAllowedDomainRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.widgetAllowedDomain.create({
      data: {
        id: newUlid(input.now),
        channelId: input.channelId,
        domain: input.domain,
        addedByStaffUserId: input.addedByStaffUserId,
        addedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return {
      id: row.id,
      domain: row.domain,
      addedByStaffUserId: row.addedByStaffUserId,
      addedAt: row.addedAt,
    };
  }

  async removeAllowedDomain(channelId: string, domain: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.widgetAllowedDomain.delete({
      where: { channelId_domain: { channelId, domain } },
    });
  }
}
