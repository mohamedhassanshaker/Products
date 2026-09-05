import { tenantFetch } from './http-client';

export interface EducationLevelSummary {
  id: number;
  name: string;
  createdAt: string;
}

export interface StageSummary {
  id: number;
  educationLevelId: number;
  name: string;
  createdAt: string;
}

export interface SubjectSummary {
  id: number;
  stageId: number;
  name: string;
  createdAt: string;
}

/** `GET /api/taxonomy/education-levels`. */
export function listEducationLevels(): Promise<EducationLevelSummary[]> {
  return tenantFetch<EducationLevelSummary[]>('/api/taxonomy/education-levels', { method: 'GET' });
}

/** `POST /api/taxonomy/education-levels` — FR-TAX-2 create-or-fetch (200 existing / 201 new; the
 * caller doesn't need to distinguish the two, per `docs/design/UX_GUIDELINES.md` §6.2/§19). */
export function createEducationLevel(name: string): Promise<EducationLevelSummary> {
  return tenantFetch<EducationLevelSummary>('/api/taxonomy/education-levels', { method: 'POST', body: JSON.stringify({ name }) });
}

/** `DELETE /api/taxonomy/education-levels/:id`. */
export function deleteEducationLevel(id: number): Promise<void> {
  return tenantFetch<void>(`/api/taxonomy/education-levels/${id}`, { method: 'DELETE' });
}

/** `GET /api/taxonomy/stages?educationLevelId=`. */
export function listStages(educationLevelId: number): Promise<StageSummary[]> {
  return tenantFetch<StageSummary[]>(`/api/taxonomy/stages?educationLevelId=${educationLevelId}`, { method: 'GET' });
}

export function createStage(educationLevelId: number, name: string): Promise<StageSummary> {
  return tenantFetch<StageSummary>('/api/taxonomy/stages', { method: 'POST', body: JSON.stringify({ educationLevelId, name }) });
}

export function deleteStage(id: number): Promise<void> {
  return tenantFetch<void>(`/api/taxonomy/stages/${id}`, { method: 'DELETE' });
}

/** `GET /api/taxonomy/subjects?stageId=`. */
export function listSubjects(stageId: number): Promise<SubjectSummary[]> {
  return tenantFetch<SubjectSummary[]>(`/api/taxonomy/subjects?stageId=${stageId}`, { method: 'GET' });
}

export function createSubject(stageId: number, name: string): Promise<SubjectSummary> {
  return tenantFetch<SubjectSummary>('/api/taxonomy/subjects', { method: 'POST', body: JSON.stringify({ stageId, name }) });
}

export function deleteSubject(id: number): Promise<void> {
  return tenantFetch<void>(`/api/taxonomy/subjects/${id}`, { method: 'DELETE' });
}
