import { tenantFetch } from './http-client';

/**
 * Tenant self-serve billing client (migration plan Phase 9 sub-slice "9b", FR-PKG-6). Local mirror of
 * `server/platform/billing`'s `TenantPlanSummary`/`TenantPlansResponse` wire types — this app's own
 * convention (every `lib/tenant-console/*-api.ts` module keeps its own copy rather than importing
 * server types directly, matching `branding-api.ts`'s identical precedent).
 */

export interface TenantPlanSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  sortOrder: number;
}

export interface TenantPlansResponse {
  currentPackageId: string | null;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null;
  packages: TenantPlanSummary[];
}

/** `GET /api/tenant/billing/plans` — requires `billing.read`. */
export function getPlans(): Promise<TenantPlansResponse> {
  return tenantFetch<TenantPlansResponse>('/api/tenant/billing/plans', { method: 'GET' });
}

/** `POST /api/tenant/billing/checkout-session` — requires `billing.manage`. Returns the real,
 * Stripe-hosted redirect URL; the caller performs the full-page `window.location.href = url`
 * navigation itself (§17.3: no in-app confirm dialog). */
export function createCheckoutSession(packageId: string): Promise<{ url: string }> {
  return tenantFetch<{ url: string }>('/api/tenant/billing/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ packageId }),
  });
}
