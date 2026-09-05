import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, withGatewayTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { CredentialTypeValue } from "@nextbot/contracts";

/**
 * `channels`' own thin credential read/write helpers against the shared
 * `credential` table (Phase 4's vault, ADR-0007) — duplicated in shape from
 * `packages/modules/connectors`'/`packages/modules/agent-platform`'s own versions
 * rather than imported, for the same reason `agent-platform`'s copy documents: no
 * module dependency allow-list edge permits `channels -> connectors` or
 * `channels -> agent-platform`, and `credential` is shared infrastructure
 * (`packages/db`), not something only one module may touch.
 */
export async function insertCredential(
  ctx: TenantContext,
  input: { id?: string; label: string; type: CredentialTypeValue; vaultRef: string; ciphertext: string; dekRef: string; maskedHint: string },
): Promise<string> {
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

export async function updateCredentialCiphertext(
  ctx: TenantContext,
  credentialId: string,
  input: { ciphertext: string; dekRef: string; maskedHint: string; vaultRef: string },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.credential)
      .set({ ciphertext: input.ciphertext, dekRef: input.dekRef, maskedHint: input.maskedHint, vaultRef: input.vaultRef, lastRotatedAt: new Date() })
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
  });
}

export async function getCredentialMaskedHint(ctx: TenantContext, credentialId: string | null): Promise<string | null> {
  if (!credentialId) return null;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ maskedHint: schema.credential.maskedHint })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0]?.maskedHint ?? null;
  });
}

/** Reads ciphertext/dek_ref for decryption — runs on the "gateway" DB role (the only
 * role DB-grant-permitted to `SELECT` these columns, LLD §3.5). Same deliberate,
 * flagged deviation as `connectors`'/`agent-platform`'s equivalent (Phase 4/10):
 * called directly from `apps/web`'s admin route and `apps/gateway`'s webhook route
 * rather than through a physically separate internal RPC egress port — the DB-level
 * security boundary holds regardless of calling process; full ADR-0004 process
 * separation for this surface is deferred alongside the others. */
export async function getCredentialForDecrypt(ctx: TenantContext, credentialId: string): Promise<{ ciphertext: string; dekRef: string } | null> {
  return withGatewayTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.credential.ciphertext, dekRef: schema.credential.dekRef })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}
