import { tenantFetch } from './http-client';

/**
 * Tenant self-serve feature-usage/quota client (FR-PKG-5, the post-Phase-10-e2e closure dispatch that
 * ports `platform/usage`). Local mirror of `server/platform/usage`'s `FeatureUsageSnapshotItem` — this
 * app's own convention (every `lib/tenant-console/*-api.ts` module keeps its own copy rather than
 * importing server types directly, matching `billing-api.ts`'s identical precedent).
 */
export interface FeatureUsageSnapshotItem {
  featureKey: string;
  featureName: string;
  unit: string;
  enabled: boolean;
  /** `null` = unlimited. */
  limit: number | null;
  used: number;
  /** `null` if `limit` is `null` (unlimited) or the feature is disabled. */
  remaining: number | null;
  resetsAt: string | null;
}

export interface TenantUsageResponse {
  features: FeatureUsageSnapshotItem[];
}

/** `GET /api/tenant/usage` — requires `billing.read` (same gate as `GET /api/tenant/billing/plans` —
 * see that route's own doc comment for why this app deliberately reuses `billing.read` rather than
 * legacy's `tenant.settings.manage`). */
export function getUsage(): Promise<TenantUsageResponse> {
  return tenantFetch<TenantUsageResponse>('/api/tenant/usage', { method: 'GET' });
}
