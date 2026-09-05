import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { TenantBranding } from "@nextbot/contracts";

export interface TenantBrandingState {
  brandingConfig: TenantBranding | null;
  whiteLabelEnabled: boolean;
}

/**
 * Reads a tenant's brand profile (FR-ADM-07). Read-only `withPlatform` call, same
 * category as `resolveTenantBySlug`/`resolveTenantById` in `resolve-tenant.ts` (a
 * caller cannot yet have a `TenantContext` bound to *this* tenant's own row when it's
 * asking about the tenant itself — e.g. the widget bootstrap path in
 * `@nextbot/conversations`, which only knows a `channelPublicKey` at this point, not
 * an authenticated admin session).
 */
export async function getTenantBranding(tenantId: string): Promise<TenantBrandingState | null> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({ brandingConfig: schema.tenant.brandingConfig, whiteLabelEnabled: schema.tenant.whiteLabelEnabled })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId));
    return rows[0] ?? null;
  });
}

/**
 * Updates a tenant's brand profile. Validation (hex color format, WCAG contrast
 * check, logo URL shape) happens at the caller/API layer against
 * `TenantBrandingSchema` + the contrast-checker utility (FR-ADM-07, Phase 9) — this
 * function only persists an already-validated value, mirroring every other module's
 * "validation happens at the edge" convention (LLD §11.3).
 */
export async function updateTenantBranding(
  tenantId: string,
  input: { brandingConfig: TenantBranding; whiteLabelEnabled?: boolean },
): Promise<void> {
  await withPlatform(async (db: PlatformClient) => {
    const values: { brandingConfig: TenantBranding; updatedAt: Date; whiteLabelEnabled?: boolean } = {
      brandingConfig: input.brandingConfig,
      updatedAt: new Date(),
    };
    if (input.whiteLabelEnabled !== undefined) values.whiteLabelEnabled = input.whiteLabelEnabled;
    await db.update(schema.tenant).set(values).where(eq(schema.tenant.id, tenantId));
  });
}
