import { platformFetch } from './http-client';

/** Local mirror of `TenantStatus` (`@examland/contracts`) — a plain string-literal union costs
 * nothing to duplicate here and keeps this client module fully independent of any server import. */
export type TenantStatus = 'Provisioning' | 'Active' | 'Suspended' | 'Failed';

/** Local mirror of `TenantSummary` (server: `@/server/platform/tenants`'s `domain/tenant.types.ts`) —
 * see `auth-api.ts`'s identical doc-comment rationale for why this is its own type, not a re-import. */
export interface TenantSummary {
  id: string;
  name: string;
  subdomainSlug: string;
  schemaName: string;
  status: TenantStatus;
  isDefault: boolean;
  allowEmailRegistration: boolean;
  allowGoogleSignIn: boolean;
  defaultSelfRegisterRole: string | null;
  logoUrl: string | null;
  accentColorOverride: string | null;
  assignedAiModelId: string | null;
  provisioningError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAfterAt: string | null;
}

export interface ListTenantsResult {
  items: TenantSummary[];
  total: number;
}

export interface ListTenantsParams {
  status?: TenantStatus;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateTenantInput {
  name: string;
  subdomainSlug: string;
  adminEmail: string;
}

export interface UpdateRegistrationSettingsInput {
  allowEmailRegistration?: boolean;
  allowGoogleSignIn?: boolean;
}

/** `GET /api/platform/tenants` (`docs/design/UX_GUIDELINES.md` §3.1). */
export function listTenants(params: ListTenantsParams = {}): Promise<ListTenantsResult> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.includeDeleted) query.set('includeDeleted', 'true');
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return platformFetch<ListTenantsResult>(`/api/platform/tenants${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

/** `GET /api/platform/tenants/:id` (§3.2). */
export function getTenant(id: string): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `POST /api/platform/tenants` (§3.3) — runs the full, synchronous provisioning workflow; can take
 * several seconds. Always resolves (not rejects) for a "created but Failed" outcome — only a hard
 * 4xx/5xx rejects (see this function's callers for the success-vs-Failed-status distinction the UX
 * doc requires). */
export function createTenant(input: CreateTenantInput): Promise<TenantSummary> {
  return platformFetch<TenantSummary>('/api/platform/tenants', { method: 'POST', body: JSON.stringify(input) });
}

/** `POST /api/platform/tenants/:id/suspend` (§3.4). */
export function suspendTenant(id: string): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}/suspend`, { method: 'POST' });
}

/** `POST /api/platform/tenants/:id/activate` (§3.4). */
export function activateTenant(id: string): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}

/** `POST /api/platform/tenants/:id/soft-delete` — new this dispatch, no legacy HTTP precedent (see
 * `app/api/platform/tenants/[id]/soft-delete/route.ts`'s own doc comment). */
export function softDeleteTenant(id: string): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}/soft-delete`, { method: 'POST' });
}

/** `POST /api/platform/tenants/:id/provisioning/retry` (§3.4) — a small, justified addition beyond
 * this dispatch's originally-enumerated scope; see `docs/plans/nextjs-rewrite-phase2-plan.md`. */
export function retryTenantProvisioning(id: string): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}/provisioning/retry`, { method: 'POST' });
}

/** `PATCH /api/platform/tenants/:id/registration-settings` (FR-MT-6). */
export function updateRegistrationSettings(id: string, input: UpdateRegistrationSettingsInput): Promise<TenantSummary> {
  return platformFetch<TenantSummary>(`/api/platform/tenants/${encodeURIComponent(id)}/registration-settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
