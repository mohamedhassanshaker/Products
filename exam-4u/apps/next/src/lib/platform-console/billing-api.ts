import { platformFetch } from './http-client';

/** Local mirror of `TenantSubscriptionSummary` (server: `@/server/platform/billing`'s
 * `SubscriptionAdminService`). */
export interface TenantSubscriptionSummary {
  packageId: string;
  packageKey: string;
  packageName: string;
  priceCents: number;
  currency: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  hasProviderCustomer: boolean;
}

/** `GET /api/platform/tenants/:id/billing` — the tenant-detail billing panel's read path. */
export function getTenantBilling(tenantId: string): Promise<{ subscription: TenantSubscriptionSummary | null }> {
  return platformFetch<{ subscription: TenantSubscriptionSummary | null }>(
    `/api/platform/tenants/${encodeURIComponent(tenantId)}/billing`,
    { method: 'GET' },
  );
}

/** `PUT /api/platform/tenants/:id/billing` — direct (non-Stripe) package reassignment. */
export function reassignTenantSubscription(tenantId: string, packageId: string): Promise<{ subscription: TenantSubscriptionSummary }> {
  return platformFetch<{ subscription: TenantSubscriptionSummary }>(`/api/platform/tenants/${encodeURIComponent(tenantId)}/billing`, {
    method: 'PUT',
    body: JSON.stringify({ packageId }),
  });
}

/** `POST /api/platform/tenants/:id/billing/checkout-session` — Platform-Admin-initiated Stripe
 * Checkout Session creation. Returns the real, Stripe-hosted redirect URL. */
export function createTenantCheckoutSession(tenantId: string, packageId: string): Promise<{ url: string }> {
  return platformFetch<{ url: string }>(`/api/platform/tenants/${encodeURIComponent(tenantId)}/billing/checkout-session`, {
    method: 'POST',
    body: JSON.stringify({ packageId }),
  });
}
