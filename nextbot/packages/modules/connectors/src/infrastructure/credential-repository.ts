import { eq, and } from "drizzle-orm";
import { generateId, schema, withTenant, withGatewayTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { CredentialTypeValue } from "./types.js";

/** Non-secret projection of `credential` — the only shape the "app" role (used by
 * `apps/web`'s admin API) is DB-grant-permitted to SELECT (`ciphertext`/`dek_ref` are
 * excluded from its column grant, see `ensure-roles.ts`). Selecting `ciphertext`
 * here would fail at the database privilege level, not just look wrong. */
export interface CredentialMaskedRow {
  id: string;
  tenantId: string;
  label: string;
  type: CredentialTypeValue;
  maskedHint: string;
  lastRotatedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function insertCredential(
  ctx: TenantContext,
  input: { id?: string; label: string; type: CredentialTypeValue; vaultRef: string; ciphertext: string; dekRef: string; maskedHint: string },
): Promise<string> {
  // Accepts a caller-supplied id so it can match the id already used as the
  // envelope-encryption AAD context (`SecretContext.id`) at encrypt time — the AAD
  // must be identical at decrypt time or `SecretsProvider.get()` fails auth-tag
  // verification (see `create-connector.ts` / `discover-tools.ts`).
  const id = input.id ?? generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.credential).values({
      id,
      tenantId: ctx.tenantId,
      label: input.label,
      type: input.type,
      vaultRef: input.vaultRef,
      ciphertext: input.ciphertext,
      dekRef: input.dekRef,
      maskedHint: input.maskedHint,
    });
  });
  return id;
}

export async function getCredentialMasked(ctx: TenantContext, credentialId: string): Promise<CredentialMaskedRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        id: schema.credential.id,
        tenantId: schema.credential.tenantId,
        label: schema.credential.label,
        type: schema.credential.type,
        maskedHint: schema.credential.maskedHint,
        lastRotatedAt: schema.credential.lastRotatedAt,
        expiresAt: schema.credential.expiresAt,
        revokedAt: schema.credential.revokedAt,
      })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}

/** Reads the ciphertext + dek_ref for decryption. Runs on the "gateway" DB role
 * (`withGatewayTenant`) — the only role DB-grant-permitted to SELECT these columns
 * (LLD §3.5). Never call this from an `apps/web` admin-list code path. */
export async function getCredentialForDecrypt(
  ctx: TenantContext,
  credentialId: string,
): Promise<{ ciphertext: string; dekRef: string } | null> {
  return withGatewayTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.credential.ciphertext, dekRef: schema.credential.dekRef })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}
