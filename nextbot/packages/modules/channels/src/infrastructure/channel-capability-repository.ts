import { eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ChannelCapability, ChannelTypeValue } from "@nextbot/contracts";

/**
 * `channel_capability` is static, non-tenant-scoped reference data (LLD §3.4) — it
 * has no `tenant_id` column and no RLS policy at all, so `withTenant`'s
 * `SET LOCAL app.current_tenant` is a no-op for this specific query (nothing reads
 * that GUC without a `tenant_id` predicate to compare it against). Read through the
 * ordinary tenant-scoped connection rather than `withPlatform` regardless: every
 * caller already holds a `TenantContext` for the surrounding channel lookup, and LLD
 * §3.2 rule 4 keeps `withPlatform`'s call sites to exactly two (tenancy provisioning +
 * internal ops) — this table simply doesn't need that bypass.
 */
export async function getChannelCapability(
  ctx: TenantContext,
  channelType: ChannelTypeValue,
): Promise<ChannelCapability | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.channelCapability)
      .where(eq(schema.channelCapability.channelType, channelType));
    const row = rows[0];
    if (!row) return null;
    return {
      channelType: row.channelType,
      supportsRichCards: row.supportsRichCards,
      supportsQuickReplies: row.supportsQuickReplies,
      supportsLists: row.supportsLists,
      supportsForms: row.supportsForms,
      supportsFileUpload: row.supportsFileUpload,
      supportsMarkdown: row.supportsMarkdown,
      supportsTypingIndicator: row.supportsTypingIndicator,
      maxQuickReplies: row.maxQuickReplies,
      maxButtonLabelChars: row.maxButtonLabelChars,
      maxTextChars: row.maxTextChars,
      formStrategy: row.formStrategy,
      listStrategy: row.listStrategy,
    };
  });
}
