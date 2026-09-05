import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue } from "@nextbot/contracts";
import type { Region } from "@nextbot/db";

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  region: Region;
  planTier: PlanTierValue;
  status: "Active" | "Suspended" | "Trial";
  /** LLD §5.3: the widget session falls back to this when the embed config's
   * `language` is `"auto"`/absent and browser auto-detection is ambiguous. */
  defaultLanguage: string;
}

/**
 * Resolves a tenant by its `slug` (the value used in the login form / widget embed
 * namespace). Read-only, so it is one of the very few legitimate `withPlatform` call
 * sites outside provisioning itself: a caller cannot have a `TenantContext` before it
 * knows *which* tenant it is talking to — this function is how it finds out. Other
 * modules (e.g. `iam`'s login flow) reach this indirectly through `@nextbot/tenancy`'s
 * public API rather than calling `withPlatform` themselves, keeping the
 * dependency-cruiser "only two call sites" rule intact.
 *
 * @returns `null` when no tenant has that slug (callers must not distinguish this
 * from other lookup failures in a user-facing message — see `InvalidCredentialsError`).
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({
        id: schema.tenant.id,
        slug: schema.tenant.slug,
        name: schema.tenant.name,
        region: schema.tenant.region,
        planTier: schema.tenant.planTier,
        status: schema.tenant.status,
        defaultLanguage: schema.tenant.defaultLanguage,
      })
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, slug));
    return rows[0] ?? null;
  });
}

/** Same as `resolveTenantBySlug`, keyed by `id` — used where a caller already has a
 * tenantId (e.g. resuming an MFA challenge token) and needs the tenant's `region`. */
export async function resolveTenantById(id: string): Promise<ResolvedTenant | null> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({
        id: schema.tenant.id,
        slug: schema.tenant.slug,
        name: schema.tenant.name,
        region: schema.tenant.region,
        planTier: schema.tenant.planTier,
        status: schema.tenant.status,
        defaultLanguage: schema.tenant.defaultLanguage,
      })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, id));
    return rows[0] ?? null;
  });
}
