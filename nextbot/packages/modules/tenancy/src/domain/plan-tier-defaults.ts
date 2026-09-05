import type { PlanTierValue } from "@nextbot/contracts";

/**
 * Provisioning-time quota template per plan tier (LLD §3.10, NFR-4a table). Pure data
 * + a pure lookup function — no I/O — so it belongs in `domain/`.
 *
 * `null` means "no cap". These are seeded onto a tenant's `tenant_runtime_quota` row
 * at creation time; an operator may tune the row afterward without changing the
 * tenant's `plan_tier` label (the tier is a template, not a live constraint).
 */
export interface PlanTierQuotaDefaults {
  maxToolCallsPerSecond: number | null;
  maxConcurrentConversations: number | null;
  maxMcpConnectors: number | null;
  /** Enterprise tenants route to the dedicated-database escape hatch (ADR-0001 §2a). */
  isDedicatedDatabase: boolean;
}

const PLAN_TIER_DEFAULTS: Record<PlanTierValue, PlanTierQuotaDefaults> = {
  Starter: {
    maxToolCallsPerSecond: 1,
    maxConcurrentConversations: 50,
    maxMcpConnectors: 3,
    isDedicatedDatabase: false,
  },
  Growth: {
    maxToolCallsPerSecond: 5,
    maxConcurrentConversations: 500,
    maxMcpConnectors: 15,
    isDedicatedDatabase: false,
  },
  Enterprise: {
    // "1,000/min → ~16/s" per the NFR-4a table.
    maxToolCallsPerSecond: 16,
    maxConcurrentConversations: 5000,
    maxMcpConnectors: null,
    isDedicatedDatabase: true,
  },
};

/** Looks up the provisioning-time quota template for a given plan tier. */
export function getPlanTierQuotaDefaults(planTier: PlanTierValue): PlanTierQuotaDefaults {
  return PLAN_TIER_DEFAULTS[planTier];
}
