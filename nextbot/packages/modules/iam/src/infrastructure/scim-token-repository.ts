import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface ScimTokenRow {
  id: string;
  tokenPrefix: string;
  tokenHash: string;
  revokedAt: Date | null;
}

/** Fetches the tenant's one active (non-revoked) SCIM token, or `null`. */
export async function getActiveScimToken(ctx: TenantContext): Promise<ScimTokenRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.scimToken.id, tokenPrefix: schema.scimToken.tokenPrefix, tokenHash: schema.scimToken.tokenHash, revokedAt: schema.scimToken.revokedAt })
      .from(schema.scimToken)
      .where(and(eq(schema.scimToken.tenantId, ctx.tenantId), isNull(schema.scimToken.revokedAt)));
    return rows[0] ?? null;
  });
}

/** Rotates the tenant's SCIM token: revokes any existing active token and issues
 * a new one — never two active tokens at once, so there is exactly one bearer
 * credential to reason about at any time. */
export async function rotateScimToken(ctx: TenantContext, input: { tokenPrefix: string; tokenHash: string }): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.scimToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.scimToken.tenantId, ctx.tenantId), isNull(schema.scimToken.revokedAt)));
    await db.insert(schema.scimToken).values({ id, tenantId: ctx.tenantId, tokenPrefix: input.tokenPrefix, tokenHash: input.tokenHash });
  });
  return id;
}

export async function revokeScimToken(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.scimToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.scimToken.tenantId, ctx.tenantId), isNull(schema.scimToken.revokedAt)));
  });
}

export async function touchScimToken(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.scimToken).set({ lastUsedAt: new Date() }).where(and(eq(schema.scimToken.tenantId, ctx.tenantId), eq(schema.scimToken.id, id)));
  });
}
