import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-26) — `platform_provider_type_policy`
 * read/write. Lives in `tenancy` (not `model-gateway`) because `withPlatform()` is
 * restricted to tenancy provisioning / `/api/internal/ops/**` callers only
 * (LLD §3.2 rule 4, enforced by `no-platform-outside-allowed-callers`) — mirrors
 * `plan-tier-definitions.ts`'s identical pattern for the sibling
 * `plan_tier_definition` table. `@nextbot/model-gateway`'s route-service reads this
 * tenant-facing check through `tenancy`'s allowed module edge, never `withPlatform`
 * itself.
 */
export interface ProviderTypePolicyRecord {
  planTier: PlanTierValue;
  allowedProviderTypes: string[];
  updatedByOperatorId: string | null;
  updatedAt: Date;
}

/** `null` means "no policy row found" (should not happen — every tier is seeded
 * permissive by migration `0048`) — callers treat `null` the same as an unrestricted
 * policy, never as an accidental lockout. */
export async function getProviderTypePolicyForTier(planTier: PlanTierValue): Promise<ProviderTypePolicyRecord | null> {
  const [row] = await withPlatform((db: PlatformClient) => db.select().from(schema.platformProviderTypePolicy).where(eq(schema.platformProviderTypePolicy.planTier, planTier)));
  return (row as ProviderTypePolicyRecord | undefined) ?? null;
}

export async function listProviderTypePolicies(): Promise<ProviderTypePolicyRecord[]> {
  return withPlatform((db: PlatformClient) => db.select().from(schema.platformProviderTypePolicy)) as Promise<ProviderTypePolicyRecord[]>;
}

/** Operator-only write (FR-AGT-26) — `/api/internal/ops/**` is the sole caller. */
export async function setProviderTypePolicy(planTier: PlanTierValue, allowedProviderTypes: string[], updatedByOperatorId?: string): Promise<ProviderTypePolicyRecord> {
  await withPlatform((db: PlatformClient) =>
    db.update(schema.platformProviderTypePolicy).set({ allowedProviderTypes, updatedByOperatorId, updatedAt: new Date() }).where(eq(schema.platformProviderTypePolicy.planTier, planTier)),
  );
  const row = await getProviderTypePolicyForTier(planTier);
  if (!row) throw new Error(`setProviderTypePolicy: no policy row exists for tier '${planTier}'`);
  return row;
}
