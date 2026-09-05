import { platformFetch } from './http-client';

/** Local mirror of `FeatureSummary` (server: `@/server/platform/billing`'s `FeaturesService`) — kept
 * as its own client-side type rather than re-imported from `server/**`, matching this module's own
 * established "the client owns its own wire-shape mirror" convention (`tenants-api.ts`). */
export interface FeatureSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  unit: string;
  resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY';
  isReferenced: boolean;
  createdAt: string;
}

export interface CreateFeatureInput {
  key: string;
  name: string;
  description?: string;
  unit: string;
  resetPeriod: 'NONE' | 'DAILY' | 'MONTHLY';
}

export interface UpdateFeatureInput {
  key?: string;
  name?: string;
  description?: string;
  unit?: string;
  resetPeriod?: 'NONE' | 'DAILY' | 'MONTHLY';
}

/** `GET /api/platform/features`. */
export function listFeatures(): Promise<{ items: FeatureSummary[] }> {
  return platformFetch<{ items: FeatureSummary[] }>('/api/platform/features', { method: 'GET' });
}

/** `GET /api/platform/features/:id`. */
export function getFeature(id: string): Promise<FeatureSummary> {
  return platformFetch<FeatureSummary>(`/api/platform/features/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `POST /api/platform/features`. */
export function createFeature(input: CreateFeatureInput): Promise<FeatureSummary> {
  return platformFetch<FeatureSummary>('/api/platform/features', { method: 'POST', body: JSON.stringify(input) });
}

/** `PATCH /api/platform/features/:id`. */
export function updateFeature(id: string, input: UpdateFeatureInput): Promise<FeatureSummary> {
  return platformFetch<FeatureSummary>(`/api/platform/features/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /api/platform/features/:id` — `204` on success (no body). */
export function deleteFeature(id: string): Promise<void> {
  return platformFetch<void>(`/api/platform/features/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
