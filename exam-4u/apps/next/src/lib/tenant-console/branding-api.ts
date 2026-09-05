import { tenantFetch } from './http-client';

/**
 * Tenant branding client (migration plan Phase 9 sub-slice "9a", FR-MT-10). Local mirror of
 * `server/platform/tenants`'s `domain/tenant.types.ts` `BrandingSummary`/`UpdateBrandingInput` wire
 * types — this app's own convention (every `lib/tenant-console/*-api.ts` module keeps its own copy
 * rather than importing server types directly, matching `confidence-calibration-api.ts`'s identical
 * precedent).
 */

export interface TenantBranding {
  logoUrl: string | null;
  accentColorOverride: string | null;
  effectiveAccentColor: string;
}

export interface UpdateBrandingInput {
  logoUrl?: string | null;
  accentColorOverride?: string | null;
}

/** `GET /api/tenant/branding`. */
export function getBranding(): Promise<TenantBranding> {
  return tenantFetch<TenantBranding>('/api/tenant/branding', { method: 'GET' });
}

/** `PATCH /api/tenant/branding`. Both fields tri-state — omit a key entirely to leave it unchanged,
 * pass `null` to clear it. */
export function updateBranding(input: UpdateBrandingInput): Promise<TenantBranding> {
  return tenantFetch<TenantBranding>('/api/tenant/branding', { method: 'PATCH', body: JSON.stringify(input) });
}
