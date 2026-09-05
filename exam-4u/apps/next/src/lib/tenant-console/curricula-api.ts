import { tenantFetch } from './http-client';

/** Local mirror of `CurriculumSummary` (server: `@/server/curricula`'s `domain/curricula.types.ts`)
 * — ownership/metadata only this phase (no `documents` field yet; see
 * `docs/plans/nextjs-rewrite-phase3-plan.md`). */
export interface CurriculumSummary {
  id: string;
  name: string;
  description: string | null;
  subjectId: number;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCurriculumInput {
  name: string;
  description?: string;
  subjectId: number;
}

export interface UpdateCurriculumInput {
  name?: string;
  description?: string;
}

/** `GET /api/curricula`. */
export function listCurricula(): Promise<CurriculumSummary[]> {
  return tenantFetch<CurriculumSummary[]>('/api/curricula', { method: 'GET' });
}

/** `GET /api/curricula/:id`. */
export function getCurriculum(id: string): Promise<CurriculumSummary> {
  return tenantFetch<CurriculumSummary>(`/api/curricula/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `POST /api/curricula`. */
export function createCurriculum(input: CreateCurriculumInput): Promise<CurriculumSummary> {
  return tenantFetch<CurriculumSummary>('/api/curricula', { method: 'POST', body: JSON.stringify(input) });
}

/** `PATCH /api/curricula/:id`. */
export function updateCurriculum(id: string, input: UpdateCurriculumInput): Promise<CurriculumSummary> {
  return tenantFetch<CurriculumSummary>(`/api/curricula/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** `DELETE /api/curricula/:id`. */
export function deleteCurriculum(id: string): Promise<void> {
  return tenantFetch<void>(`/api/curricula/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
