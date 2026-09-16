/**
 * Resolve which tenant owns a WhatsApp `phone_number_id` (Meta's real field for this,
 * `entry[].changes[].value.metadata.phone_number_id`) — the inbound webhook's own tenant-
 * resolution problem, since Meta's payload names no tenant at all.
 *
 * Uses `platformScope: "channel-routing"` (`tenant-context.ts`'s own doc comment, added for
 * this wave) — a real, per-request cross-tenant read, structurally identical to the
 * `"identity"` scope's own justification: an ordinary lookup that reaches across the
 * tenant/platform boundary on every real inbound message, not a rare bulk/administrative
 * operation, so it needs no per-call audit entry of its own (unlike `"provisioning"`/
 * `"migration"`, which mutate platform-global state).
 *
 * ## The scan, and its honest, documented limit
 *
 * Enumerates every `Active` tenant and checks each one's `WhatsAppConfig.phoneNumberId` in
 * turn, first match wins. **This does not scale past a handful of tenants** — a production
 * deployment would maintain a reverse index (`phoneNumberId -> tenantSlug`) instead, updated
 * whenever a `WhatsAppConfig` is created or its number changes. No such index exists in the
 * schema today (`prisma/tenant/schema.prisma`/`prisma/platform/schema.prisma`, both grepped
 * before writing this rather than inferred), and adding one is a real, separate migration —
 * out of this wave's scope to invent without stronger justification than "it would be
 * faster." For this dev environment's tenant count (a handful of government entities), an
 * O(tenants) scan per inbound message is a real, working, honestly-trimmed solution, not a
 * placeholder pretending to be a real one.
 */
import { runWithTenant } from "../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../platform/tenancy/tenant-slug.js";
import { assertValidSlugShape } from "../../../platform/tenancy/tenant-slug.js";
import { getPlatformDb, getTenantDb } from "../../../platform/adapters/outbound/sql/tenant-db.js";

export interface ResolvedWhatsAppTenant {
  readonly tenantSlug: TenantSlug;
  readonly channelId: string;
  readonly optInRequired: boolean;
  readonly webhookVerifySecretRef: string;
  readonly credentialSecretRef: string;
}

export async function resolveTenantByWhatsAppPhoneNumberId(
  phoneNumberId: string,
  traceId: string,
): Promise<ResolvedWhatsAppTenant | null> {
  // Bind a placeholder tenant to satisfy `getPlatformDb()`'s context requirement while the
  // real tenant is still unknown. `assertValidSlugShape` only checks shape (2-30 lowercase
  // letters/digits/underscores, no hyphens) — it does not, and cannot, mean "this operation
  // concerns that tenant." Mirrors the real, already-established precedent for this exact
  // shape of problem: `scripts/bootstrap-platform-schema.ts` binds the real, existing "sewa"
  // slug purely to satisfy this same type requirement before running a platform-only
  // operation that names no particular tenant. The bound value is never read by
  // `getPlatformDb()` itself (only `context.platformScope` is checked), so which real slug
  // is used here is immaterial — "sewa" is used because it is guaranteed to already exist,
  // not because this lookup concerns SEWA specifically.
  const activeTenants = await runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId,
      platformScope: "channel-routing",
    },
    async () =>
      getPlatformDb().tenant.findMany({ where: { status: "Active" }, select: { slug: true } }),
  );

  for (const { slug } of activeTenants) {
    const tenantSlug = assertValidSlugShape(slug);
    const found = await runWithTenant(
      { tenant: tenantSlug, principal: null, traceId, platformScope: "channel-routing" },
      async () => getTenantDb().whatsAppConfig.findUnique({ where: { phoneNumberId } }),
    );
    if (found) {
      return {
        tenantSlug,
        channelId: found.channelId,
        optInRequired: found.optInRequired,
        webhookVerifySecretRef: found.webhookVerifySecretRef,
        credentialSecretRef: found.credentialSecretRef,
      };
    }
  }
  return null;
}
