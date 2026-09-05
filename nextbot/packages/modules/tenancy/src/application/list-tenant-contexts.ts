import { eq } from "drizzle-orm";
import { schema, type TenantContext } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";

/**
 * Enumerates every active tenant as a ready-to-use `TenantContext` (Sandbox
 * environment — the environment a background sweep operates against is a separate,
 * later concern; this exists so a cross-tenant scheduled job can iterate tenants
 * without ever holding `withPlatform` itself, per LLD §3.2 rule 4's "callable only
 * from tenancy provisioning and the internal ops surface" restriction). Used by
 * `packages/modules/agent-platform`'s Git PR reconciliation sweep (ADR-0009) — and
 * intended to be the same seam future cross-tenant sweeps (idle-conversation sweep,
 * retention purge, connector health check) reuse rather than each reaching for
 * `withPlatform` on their own.
 */
export async function listActiveTenantContexts(): Promise<TenantContext[]> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({ id: schema.tenant.id, region: schema.tenant.region })
      .from(schema.tenant)
      .where(eq(schema.tenant.status, "Active"));
    return rows.map((r) => ({ tenantId: r.id, region: r.region, environment: "Sandbox" as const }));
  });
}
