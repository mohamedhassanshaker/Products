// PUBLIC API for @nextbot/tenancy — the ONLY file other packages may import from
// (LLD §2.2).
export { provisionTenant, type ProvisionedTenant } from "./application/provision-tenant.js";
export { resolveTenantBySlug, resolveTenantById, type ResolvedTenant } from "./application/resolve-tenant.js";
export {
  getPlanTierQuotaDefaults,
  type PlanTierQuotaDefaults,
} from "./domain/plan-tier-defaults.js";
export { validateRetentionDays, INDEFINITE_RETENTION, computePurgeCutoff } from "./domain/retention-policy.js";
export { getTenantBranding, updateTenantBranding, type TenantBrandingState } from "./application/tenant-branding.js";
export { updateBranding } from "./application/update-branding.js";
export { checkContrastRatio, MIN_AA_CONTRAST_RATIO, type ContrastCheckResult } from "./domain/contrast-checker.js";
export { handleGetBranding, handleUpdateBranding } from "./http/admin-routes.js";
export {
  getAllowOutOfRegionInference,
  getTenantDataPolicy,
  updateTenantDataPolicy,
  markPurgeRun,
  type TenantDataPolicyState,
  type UpdateTenantDataPolicyInput,
} from "./application/data-residency.js";
export { listActiveTenantContexts } from "./application/list-tenant-contexts.js";
export {
  claimConcurrentRunSlot,
  checkToolCallRate,
  getRuntimeQuota,
  getLiveConcurrentRunCount,
  _resetRuntimeQuotaClientForTests,
} from "./application/runtime-quota.js";
export { listAllTenants, type TenantSummary, type TenantStatusValue } from "./application/list-all-tenants.js";
export {
  getTenantOperatorSummary,
  type TenantOperatorSummary,
} from "./application/tenant-operator-summary.js";
export { updateTenantStatus, type TenantStatusUpdateResult } from "./application/update-tenant-status.js";
export { updateTenantPlanTier, type TenantPlanTierUpdateResult } from "./application/update-tenant-plan-tier.js";
export { reseedTenantQuotaFromTier, type ReseedTenantQuotaResult } from "./application/reseed-tenant-quota.js";
export { getTenantPlanTier } from "./application/get-tenant-plan-tier.js";
export {
  getProviderTypePolicyForTier,
  listProviderTypePolicies,
  setProviderTypePolicy,
  type ProviderTypePolicyRecord,
} from "./application/provider-type-policy.js";
export {
  listPlanTierDefinitions,
  getPlanTierDefinition,
  updatePlanTierDefinition,
  getEffectivePlanTierDefaults,
  type PlanTierDefinitionRecord,
} from "./application/plan-tier-definitions.js";
export {
  reconcileStrandedGraphProvisioning,
  type ReconcileGraphProvisioningResult,
} from "./application/reconcile-graph-provisioning.js";
// Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel identity
// resolution's tenant-opt-in toggle (OFF by default).
export {
  getIdentityResolutionPolicy,
  setIdentityResolutionPolicyEnabled,
} from "./application/identity-resolution-policy.js";
// Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Consented Break-Glass
// Operator Access: the tenant-side consent grant (Settings screen) and the
// platform-ops-side fail-closed activation/read gate.
export {
  createBreakglassGrant,
  getActiveBreakglassGrant,
  getMostRecentBreakglassGrant,
  listBreakglassGrants,
  revokeBreakglassGrant,
  type BreakglassGrantRecord,
  type CreateBreakglassGrantInput,
} from "./application/breakglass-grant.js";
export { activateBreakglassAccess, requireActiveBreakglassTenantContext } from "./application/breakglass-access.js";
export {
  classifyInactiveBreakglassGrant,
  computeBreakglassGrantExpiry,
  isBreakglassGrantActive,
} from "./domain/breakglass-grant-policy.js";
