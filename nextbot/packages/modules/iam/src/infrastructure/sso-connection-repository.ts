import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** `sso_connection` (Phase 4, BL-36, FR-SEC-10) — one row per tenant. See
 * `packages/db/src/schema/iam.ts`'s doc comment for the field-by-protocol split. */
export interface SsoConnectionRow {
  id: string;
  tenantId: string;
  protocol: "Saml" | "Oidc";
  displayName: string;
  status: "Disabled" | "Active";
  jitProvisioningEnabled: boolean;
  defaultRoleId: string | null;
  groupClaimName: string | null;
  oidcIssuerUrl: string | null;
  oidcClientId: string | null;
  oidcClientSecretCiphertext: string | null;
  oidcClientSecretDekRef: string | null;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlIdpCertificate: string | null;
}

export async function getSsoConnection(ctx: TenantContext): Promise<SsoConnectionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.ssoConnection).where(eq(schema.ssoConnection.tenantId, ctx.tenantId));
    return rows[0] ?? null;
  });
}

/** Upserts the tenant's single SSO connection (insert-or-replace-in-place —
 * never a second row, enforced by the `sso_connection_tenant_key` unique index
 * as a backstop even though the application layer always reads-then-writes). */
export async function upsertSsoConnection(
  ctx: TenantContext,
  input: Omit<SsoConnectionRow, "id" | "tenantId" | "status"> & { id?: string },
): Promise<string> {
  const existing = await getSsoConnection(ctx);
  const id = existing?.id ?? input.id ?? generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    if (existing) {
      await db
        .update(schema.ssoConnection)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(schema.ssoConnection.tenantId, ctx.tenantId), eq(schema.ssoConnection.id, id)));
    } else {
      await db.insert(schema.ssoConnection).values({ id, tenantId: ctx.tenantId, status: "Disabled", ...input });
    }
  });
  return id;
}

export async function setSsoConnectionStatus(ctx: TenantContext, status: "Active" | "Disabled"): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.ssoConnection)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.ssoConnection.tenantId, ctx.tenantId));
  });
}
