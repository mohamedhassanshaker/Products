import { eq, and } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** Persists an envelope-encrypted TOTP secret row, returning its id (used as the
 * `nb://<tenant>/mfa-secret/<id>` vault_ref suffix). */
export async function insertMfaSecret(
  ctx: TenantContext,
  input: { id?: string; userId: string; ciphertext: string; dekRef: string },
): Promise<string> {
  // `id` may be caller-supplied so it matches the id already used as the
  // envelope-encryption AAD context at encrypt time (see `mfa-secret-vault.ts`).
  const id = input.id ?? generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.mfaSecret).values({ id, tenantId: ctx.tenantId, userId: input.userId, ciphertext: input.ciphertext, dekRef: input.dekRef });
  });
  return id;
}

export async function findMfaSecretById(
  ctx: TenantContext,
  id: string,
): Promise<{ ciphertext: string; dekRef: string; userId: string } | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.mfaSecret.ciphertext, dekRef: schema.mfaSecret.dekRef, userId: schema.mfaSecret.userId })
      .from(schema.mfaSecret)
      .where(and(eq(schema.mfaSecret.tenantId, ctx.tenantId), eq(schema.mfaSecret.id, id)));
    return rows[0] ?? null;
  });
}
