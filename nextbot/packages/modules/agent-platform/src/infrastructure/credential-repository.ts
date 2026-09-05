import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, withGatewayTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { CredentialTypeValue } from "@nextbot/contracts";

/**
 * `agent-platform`'s own thin credential read/write helpers against the shared
 * `credential` table (Phase 4's vault, ADR-0007) — duplicated in shape from
 * `packages/modules/connectors`' own version rather than imported from it, because
 * the module dependency allow-list (LLD §2.3 / `eslint.config.mjs`) does not permit
 * `agent-platform -> connectors`, and `credential` itself is shared infrastructure
 * (`packages/db`), not something only `connectors` may touch.
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

/** Reads ciphertext/dek_ref for decryption — runs on the "gateway" DB role (the only
 * role DB-grant-permitted to `SELECT` these columns, LLD §3.5). Same deliberate,
 * flagged deviation as `connectors`' `discoverTools()` (Phase 4): called directly
 * from `apps/web`'s admin route rather than through a physically separate
 * `apps/gateway` egress call — the DB-level security boundary holds regardless of
 * calling process; full ADR-0004 process separation is deferred to Phase 12. */
export async function getCredentialForDecrypt(ctx: TenantContext, credentialId: string): Promise<{ ciphertext: string; dekRef: string } | null> {
  return withGatewayTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.credential.ciphertext, dekRef: schema.credential.dekRef })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}
