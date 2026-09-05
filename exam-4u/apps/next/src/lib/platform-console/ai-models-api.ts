import { platformFetch } from './http-client';

/** Local mirror of `ApprovedAiModelSummary` (server: `@/server/platform/ai-models`'s
 * `AiModelsService`). */
export interface ApprovedAiModelSummary {
  id: string;
  openRouterModelId: string;
  displayName: string;
  isEnabled: boolean;
  isPlatformDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApproveAiModelInput {
  openRouterModelId: string;
  displayName: string;
}

export interface UpdateAiModelInput {
  displayName?: string;
  isEnabled?: boolean;
}

/** The tenant-detail "AI model" panel's shape (server: `AiModelsService.resolveEffectiveModel`). */
export interface EffectiveAiModel {
  source: 'assigned' | 'platform_default';
  openRouterModelId: string;
  displayName: string;
}

/** `GET /api/platform/ai-models`. `includeDisabled` defaults to `false` (the per-tenant assignment
 * dropdown's own requirement — never offer a disabled model as a new assignment target). */
export function listAiModels(includeDisabled = false): Promise<{ items: ApprovedAiModelSummary[] }> {
  const qs = includeDisabled ? '?includeDisabled=true' : '';
  return platformFetch<{ items: ApprovedAiModelSummary[] }>(`/api/platform/ai-models${qs}`, { method: 'GET' });
}

/** `GET /api/platform/ai-models/:id`. */
export function getAiModel(id: string): Promise<ApprovedAiModelSummary> {
  return platformFetch<ApprovedAiModelSummary>(`/api/platform/ai-models/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `POST /api/platform/ai-models`. */
export function approveAiModel(input: ApproveAiModelInput): Promise<ApprovedAiModelSummary> {
  return platformFetch<ApprovedAiModelSummary>('/api/platform/ai-models', { method: 'POST', body: JSON.stringify(input) });
}

/** `PATCH /api/platform/ai-models/:id`. */
export function updateAiModel(id: string, input: UpdateAiModelInput): Promise<ApprovedAiModelSummary> {
  return platformFetch<ApprovedAiModelSummary>(`/api/platform/ai-models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `PUT /api/platform/ai-models/:id/default`. */
export function setDefaultAiModel(id: string): Promise<ApprovedAiModelSummary> {
  return platformFetch<ApprovedAiModelSummary>(`/api/platform/ai-models/${encodeURIComponent(id)}/default`, { method: 'PUT' });
}

/** `DELETE /api/platform/ai-models/:id` — `204` on success (no body). */
export function deleteAiModel(id: string): Promise<void> {
  return platformFetch<void>(`/api/platform/ai-models/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** `PUT /api/platform/tenants/:id/ai-model` (FR-AI-3) — assigns a tenant to an allowlisted model. */
export function assignTenantAiModel(tenantId: string, approvedAiModelId: string): Promise<EffectiveAiModel> {
  return platformFetch<EffectiveAiModel>(`/api/platform/tenants/${encodeURIComponent(tenantId)}/ai-model`, {
    method: 'PUT',
    body: JSON.stringify({ approvedAiModelId }),
  });
}

/** `DELETE /api/platform/tenants/:id/ai-model` (FR-AI-3) — reverts to the platform default. */
export function unassignTenantAiModel(tenantId: string): Promise<EffectiveAiModel> {
  return platformFetch<EffectiveAiModel>(`/api/platform/tenants/${encodeURIComponent(tenantId)}/ai-model`, { method: 'DELETE' });
}
