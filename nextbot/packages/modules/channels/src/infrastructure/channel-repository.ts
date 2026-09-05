import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ChannelStatusValue, ChannelTypeValue, EnvironmentValue } from "@nextbot/contracts";

export interface ChannelRow {
  id: string;
  tenantId: string;
  type: ChannelTypeValue;
  name: string;
  status: ChannelStatusValue;
  environment: EnvironmentValue;
  config: Record<string, unknown>;
  publicKey: string;
  /**
   * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2) — **which bot answers
   * on this channel**, the missing first hop of the resolution chain
   * `channel → agent definition → deployment traffic split → version`.
   *
   * Replaces the vestigial `agent_definition_version_id` column (dropped by migration
   * `0084`, proven unused). `null` means "no binding", which is a supported state: the
   * turn falls back to the pre-Phase-17 tenant-wide lookup, so every configuration this
   * build could previously express behaves exactly as before.
   */
  agentDefinitionId: string | null;
  createdAt: Date;
}

export async function findChannelByName(
  ctx: TenantContext,
  environment: EnvironmentValue,
  name: string,
): Promise<ChannelRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.channel)
      .where(
        and(
          eq(schema.channel.tenantId, ctx.tenantId),
          eq(schema.channel.environment, environment),
          eq(schema.channel.name, name),
          isNull(schema.channel.deletedAt),
        ),
      );
    return (rows[0] as ChannelRow | undefined) ?? null;
  });
}

export async function findChannelById(ctx: TenantContext, id: string): Promise<ChannelRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.channel)
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), eq(schema.channel.id, id)));
    return (rows[0] as ChannelRow | undefined) ?? null;
  });
}

/**
 * Resolves a channel by its embed-snippet `publicKey`, scoped to a tenant already
 * known to `ctx` (LLD §5.3 `CreateWidgetSessionRequest.channelPublicKey`). Callers
 * must have already resolved `tenantSlug` -> `tenantId` (via `@nextbot/tenancy`) —
 * this function does not cross tenants itself, it just looks up within one.
 */
export async function findChannelByPublicKey(ctx: TenantContext, publicKey: string): Promise<ChannelRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.channel)
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), eq(schema.channel.publicKey, publicKey)));
    return (rows[0] as ChannelRow | undefined) ?? null;
  });
}

export async function listChannels(ctx: TenantContext): Promise<ChannelRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.channel)
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), isNull(schema.channel.deletedAt)))) as ChannelRow[];
  });
}

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2, LLD §15.3/§15.6) — the
 * **hot per-turn read**: which agent definition, if any, is bound to this channel.
 *
 * Deliberately narrow (one indexed column, backed by
 * `channel_tenant_agent_definition_idx`) rather than reusing `findChannelById`, because
 * this runs on every single live turn at both entry points and has no business pulling a
 * channel's whole `config` blob to answer a one-uuid question.
 *
 * The composition root calls this and passes the id into `resolveTurnAgentVersion`;
 * `agent-platform` may not depend on `channels` (LLD §14.1's allow-list), which is exactly
 * why the chain is split this way rather than resolved inside the resolver.
 *
 * @returns the bound `agent_definition.id`, or `null` for an unbound channel **or** a
 *   channel id that does not resolve at all — both correctly mean "use the tenant-wide
 *   fallback", and collapsing them here keeps a bad channel id from failing a live turn.
 */
export async function findAgentDefinitionIdForChannel(ctx: TenantContext, channelId: string): Promise<string | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ agentDefinitionId: schema.channel.agentDefinitionId })
      .from(schema.channel)
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), eq(schema.channel.id, channelId)));
    return rows[0]?.agentDefinitionId ?? null;
  });
}

/**
 * Sets (or clears, with `null`) a channel's agent-definition binding — the "Answered by"
 * selector on the Channels screen (Phase 17, LLD §15.7's `PATCH /admin/channels/{id}`).
 *
 * Clearing is a first-class action, not an omission: an unbound channel falls back to the
 * tenant-wide lookup, which is a legitimate configuration for a single-bot tenant.
 *
 * The `tenant_id` predicate plus RLS means a cross-tenant `agentDefinitionId` cannot be
 * bound here — the FK is checked against rows this tenant's session can see, so an id
 * belonging to another tenant fails as a foreign-key violation rather than silently
 * pointing a channel at another tenant's bot.
 */
export async function setChannelAgentDefinitionBinding(ctx: TenantContext, channelId: string, agentDefinitionId: string | null): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.channel)
      .set({ agentDefinitionId, updatedAt: new Date() })
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), eq(schema.channel.id, channelId)));
  });
}

/** Flips `channel.status` (used by the WhatsApp activate flow and, generically, by
 * any future channel-type's own readiness gate — FR-OC-03). */
export async function updateChannelStatus(ctx: TenantContext, channelId: string, status: ChannelStatusValue): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.channel)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.channel.tenantId, ctx.tenantId), eq(schema.channel.id, channelId)));
  });
}

export async function insertChannel(
  ctx: TenantContext,
  input: {
    type: ChannelTypeValue;
    name: string;
    environment: EnvironmentValue;
    config: Record<string, unknown>;
    publicKey: string;
    /** New channels are created `Active` immediately — unlike `connector.status`
     * (computed by a health subsystem), a WebWidget channel has no external
     * connectivity to verify before it can serve traffic. */
    status?: ChannelStatusValue;
  },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.channel).values({
      id,
      tenantId: ctx.tenantId,
      type: input.type,
      name: input.name,
      environment: input.environment,
      config: input.config,
      publicKey: input.publicKey,
      status: input.status ?? "Active",
    });
  });
  return id;
}
