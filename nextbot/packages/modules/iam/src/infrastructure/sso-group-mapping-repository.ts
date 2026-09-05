import { and, eq, inArray } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** `sso_group_mapping` (LLD §3.3, schema-ready since Phase 2; wired up this
 * phase, BL-36) — maps an IdP-asserted group claim to a role. */
export interface SsoGroupMappingRow {
  id: string;
  externalGroup: string;
  roleId: string;
}

export async function listSsoGroupMappings(ctx: TenantContext): Promise<SsoGroupMappingRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return db
      .select({ id: schema.ssoGroupMapping.id, externalGroup: schema.ssoGroupMapping.externalGroup, roleId: schema.ssoGroupMapping.roleId })
      .from(schema.ssoGroupMapping)
      .where(eq(schema.ssoGroupMapping.tenantId, ctx.tenantId));
  });
}

/** Resolves the set of role ids mapped from the IdP's asserted groups — used at
 * every SSO login to (re-)derive role assignment fresh, never trusted from a
 * stale prior assignment (see `sso-login.ts`). */
export async function resolveRoleIdsForGroups(ctx: TenantContext, groups: string[]): Promise<string[]> {
  if (groups.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ roleId: schema.ssoGroupMapping.roleId })
      .from(schema.ssoGroupMapping)
      .where(and(eq(schema.ssoGroupMapping.tenantId, ctx.tenantId), inArray(schema.ssoGroupMapping.externalGroup, groups)));
    return Array.from(new Set(rows.map((r) => r.roleId)));
  });
}

export async function upsertSsoGroupMapping(ctx: TenantContext, externalGroup: string, roleId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .insert(schema.ssoGroupMapping)
      .values({ id: generateId(), tenantId: ctx.tenantId, externalGroup, roleId })
      .onConflictDoUpdate({ target: [schema.ssoGroupMapping.tenantId, schema.ssoGroupMapping.externalGroup], set: { roleId } });
  });
}

export async function deleteSsoGroupMapping(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.ssoGroupMapping).where(and(eq(schema.ssoGroupMapping.tenantId, ctx.tenantId), eq(schema.ssoGroupMapping.id, id)));
  });
}
