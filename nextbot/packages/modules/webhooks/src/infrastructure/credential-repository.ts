import { eq, and } from "drizzle-orm";
import { generateId, schema, withTenant, withGatewayTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { CredentialTypeValue } from "@nextbot/contracts";

/**
 * `webhooks`'s own thin credential read/write helpers against the shared
 * `credential` table (Phase 4's vault, ADR-0007) — duplicated in shape from
 * `packages/modules/agent-platform`'s own version (itself duplicated from
 * `connectors`'), rather than imported, because the module dependency allow-list
 * (LLD §2.3 / `eslint.config.mjs`) does not permit a `webhooks -> agent-platform` or
 * `webhooks -> connectors` edge, and `credential` itself is shared infrastructure
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

/** Reads ciphertext/dek_ref for decryption — runs on the "gateway" DB role (the only
 * role DB-grant-permitted to `SELECT` these columns, LLD §3.5), same deviation this
 * codebase's other direct (non-`apps/gateway`-process) decrypt call sites already
 * disclose (e.g. `agent-platform`'s Git connection service). */
export async function getCredentialForDecrypt(ctx: TenantContext, credentialId: string): Promise<{ ciphertext: string; dekRef: string } | null> {
  return withGatewayTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.credential.ciphertext, dekRef: schema.credential.dekRef })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}
