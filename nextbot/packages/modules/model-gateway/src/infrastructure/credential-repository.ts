import { eq, and } from "drizzle-orm";
import { generateId, schema, withTenant, withGatewayTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Thin per-module wrapper over the shared `credential` vault table — the same
 * envelope-encryption store every other module's credentials use (ADR-0007), never a
 * new secret-storage mechanism (this dispatch's own requirement). Mirrors
 * `packages/modules/agent-platform/src/infrastructure/credential-repository.ts` and
 * `packages/modules/connectors/src/infrastructure/credential-repository.ts` — each
 * module keeps its own thin copy rather than reaching across a module boundary for
 * something this small, matching the established convention in this codebase.
 */
export async function insertCredential(
  ctx: TenantContext,
  input: { id?: string; label: string; vaultRef: string; ciphertext: string; dekRef: string; maskedHint: string },
): Promise<string> {
  const id = input.id ?? generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.credential).values({
      id,
      tenantId: ctx.tenantId,
      label: input.label,
      type: "ModelProviderKey",
      vaultRef: input.vaultRef,
      ciphertext: input.ciphertext,
      dekRef: input.dekRef,
      maskedHint: input.maskedHint,
    });
  });
  return id;
}

export async function getCredentialForDecrypt(ctx: TenantContext, credentialId: string): Promise<{ ciphertext: string; dekRef: string } | null> {
  return withGatewayTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ ciphertext: schema.credential.ciphertext, dekRef: schema.credential.dekRef })
      .from(schema.credential)
      .where(and(eq(schema.credential.tenantId, ctx.tenantId), eq(schema.credential.id, credentialId)));
    return rows[0] ?? null;
  });
}
