import type { TenantStatus } from '@examland/contracts';

/** FR-MT-1's documented required inputs at tenant creation: "tenant name (non-empty), desired
 * subdomain." Ported verbatim from `legacy/api/src/platform/tenants/domain/tenant.types.ts`. */
export interface CreateTenantInput {
  name: string;
  subdomainSlug: string;
}

/**
 * The full, read-oriented projection of a `platform.tenant` row `TenantsService` hands back to its
 * callers — ported verbatim from `legacy/api/src/platform/tenants/domain/tenant.types.ts`.
 * Deliberately a plain data shape (not the TypeORM entity itself) — a future `api/**` Route Handler
 * layer must consume this shape rather than `TenantEntity` directly (LLD §1.4-equivalent boundary).
 */
export interface TenantSummary {
  id: string;
  name: string;
  subdomainSlug: string;
  schemaName: string;
  status: TenantStatus;
  isDefault: boolean;
  allowEmailRegistration: boolean;
  allowGoogleSignIn: boolean;
  /** FR-IAM-2: role auto-assigned to newly self-registered users, if the tenant configured one;
   * `null` means a self-registered user gets no roles by default. Read by the `auth` module (a later
   * Phase 1 sub-dispatch) via this summary. */
  defaultSelfRegisterRole: string | null;
  logoUrl: string | null;
  /** FR-MT-10 — write path is `TenantsService.updateBranding` (Phase 9 sub-slice "9a"); `null` =
   * platform default accent applies. */
  accentColorOverride: string | null;
  /** FR-AI-3 (Phase 5 owns the write path); `null` = resolves to the current platform default. */
  assignedAiModelId: string | null;
  provisioningError: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  purgeAfterAt: Date | null;
}

/** Filter/pagination input for {@link import('../application/tenants.service').TenantsService.list}. */
export interface ListTenantsOptions {
  status?: TenantStatus;
  /** Includes soft-deleted (`deletedAt IS NOT NULL`) tenants — off by default so an ordinary tenant
   * list doesn't surface tenants pending purge unless explicitly asked for. */
  includeDeleted?: boolean;
  /** 1-based page number; defaults to 1. */
  page?: number;
  /** Defaults to 20, capped at 100 to bound a single query's result size. */
  pageSize?: number;
}

export interface ListTenantsResult {
  items: TenantSummary[];
  total: number;
}

/**
 * FR-MT-10 — the read-oriented projection {@link import('../application/tenants.service').TenantsService.getBranding}/
 * `.updateBranding` hand back. `effectiveAccentColor` is always populated (the override, or the
 * platform default) so a caller (the `/settings/branding` page, `PATCH`'s own response body) never
 * has to re-derive that fallback itself.
 */
export interface BrandingSummary {
  logoUrl: string | null;
  accentColorOverride: string | null;
  effectiveAccentColor: string;
}

/** `PATCH /api/tenant/branding` input (FR-MT-10) — tri-state per field: `undefined` = leave
 * unchanged, `null` = clear (revert to platform default), a string = validate + set. Mirrors legacy's
 * `UpdateBrandingDto`'s identical tri-state contract. */
export interface UpdateBrandingInput {
  logoUrl?: string | null;
  accentColorOverride?: string | null;
}
