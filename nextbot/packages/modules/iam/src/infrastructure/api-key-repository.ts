import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { PermissionMatrix } from "@nextbot/contracts";

export interface ApiKeyRow {
  id: string;
  serviceAccountUserId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopeMatrix: PermissionMatrix | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function insertApiKey(
  ctx: TenantContext,
  input: { serviceAccountUserId: string; name: string; keyPrefix: string; keyHash: string; scopeMatrix: PermissionMatrix | null; expiresAt?: Date },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.apiKey).values({
      id,
      tenantId: ctx.tenantId,
      serviceAccountUserId: input.serviceAccountUserId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      scopeMatrix: input.scopeMatrix,
      expiresAt: input.expiresAt,
    });
  });
  return id;
}

/** Tenant-scoped lookup by the key's `keyId` (`key_prefix`) segment — never a
 * cross-tenant scan (see `domain/api-key-format.ts`'s module doc). */
export async function findApiKeyByPrefix(ctx: TenantContext, keyPrefix: string): Promise<ApiKeyRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.apiKey)
      .where(and(eq(schema.apiKey.tenantId, ctx.tenantId), eq(schema.apiKey.keyPrefix, keyPrefix)));
    const row = rows[0];
    return row ? { ...row, scopeMatrix: row.scopeMatrix as PermissionMatrix | null } : null;
  });
}

export async function listApiKeysForServiceAccount(ctx: TenantContext, serviceAccountUserId: string): Promise<ApiKeyRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.apiKey)
      .where(and(eq(schema.apiKey.tenantId, ctx.tenantId), eq(schema.apiKey.serviceAccountUserId, serviceAccountUserId)));
    return rows.map((r) => ({ ...r, scopeMatrix: r.scopeMatrix as PermissionMatrix | null }));
  });
}

export async function revokeApiKey(ctx: TenantContext, keyId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.apiKey)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKey.tenantId, ctx.tenantId), eq(schema.apiKey.id, keyId), isNull(schema.apiKey.revokedAt)));
  });
}

export async function touchApiKey(ctx: TenantContext, keyId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.apiKey).set({ lastUsedAt: new Date() }).where(and(eq(schema.apiKey.tenantId, ctx.tenantId), eq(schema.apiKey.id, keyId)));
  });
}
