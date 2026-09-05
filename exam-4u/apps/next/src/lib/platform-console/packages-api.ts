import { platformFetch } from './http-client';

/** Local mirror of `PackageSummary`/`PackageDetail` (server: `@/server/platform/billing`'s
 * `PackagesService`). */
export interface PackageSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PackageFeatureConfig {
  featureId: string;
  limit: number | null;
}

export interface PackageDetail extends PackageSummary {
  features: PackageFeatureConfig[];
}

export interface CreatePackageInput {
  key: string;
  name: string;
  description?: string;
  priceCents: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdatePackageInput {
  key?: string;
  name?: string;
  description?: string;
  priceCents?: number;
  isActive?: boolean;
  sortOrder?: number;
}

/** `GET /api/platform/packages`. `activeOnly` (added Phase 2 sub-slice "2c") narrows to `isActive:
 * true` packages — the tenant-detail billing panel's reassignment dropdown's own requirement (never
 * offer an inactive package as a new assignment target, matching the AI-model allowlist panel's
 * identical "never offer a disabled option" rule). */
export function listPackages(activeOnly = false): Promise<{ items: PackageSummary[] }> {
  const qs = activeOnly ? '?activeOnly=true' : '';
  return platformFetch<{ items: PackageSummary[] }>(`/api/platform/packages${qs}`, { method: 'GET' });
}

/** `GET /api/platform/packages/:id`. */
export function getPackage(id: string): Promise<PackageDetail> {
  return platformFetch<PackageDetail>(`/api/platform/packages/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `POST /api/platform/packages`. */
export function createPackage(input: CreatePackageInput): Promise<PackageSummary> {
  return platformFetch<PackageSummary>('/api/platform/packages', { method: 'POST', body: JSON.stringify(input) });
}

/** `PATCH /api/platform/packages/:id`. */
export function updatePackage(id: string, input: UpdatePackageInput): Promise<PackageSummary> {
  return platformFetch<PackageSummary>(`/api/platform/packages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `PUT /api/platform/packages/:id/features` — the feature-association picker's atomic full replace
 * (`docs/design/UX_GUIDELINES.md`'s new association-picker guidance, added this dispatch). */
export function replacePackageFeatures(id: string, features: PackageFeatureConfig[]): Promise<PackageDetail> {
  return platformFetch<PackageDetail>(`/api/platform/packages/${encodeURIComponent(id)}/features`, {
    method: 'PUT',
    body: JSON.stringify({ features }),
  });
}
