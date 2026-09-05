import { tenantFetch } from './http-client';

/** Local mirror of `ExamModuleSummary` (server: `@/server/exam-authoring`'s
 * `domain/exam-authoring.types.ts`). */
export interface ExamModuleSummary {
  id: string;
  moduleName: string;
  questionCount: number;
}

/** Local mirror of `ExamTypeCurriculumLinkSummary` (server: `@/server/exam-authoring`'s
 * `domain/exam-authoring.types.ts`) — FR-AUTH-4's Curriculum link, resolved with a real Curriculum
 * name. Surfaced for real on `/exam-types/:id` since Phase 6 sub-slice "6c"'s real-browser closure pass
 * (the write path existed a full sub-slice before the read path did). */
export interface ExamTypeCurriculumLinkSummary {
  curriculumId: string;
  curriculumName: string;
  contextWeight: number;
  applicableModules: string[] | null;
}

/** Local mirror of `ExamTypeSummary`. */
export interface ExamTypeSummary {
  id: string;
  name: string;
  description: string | null;
  totalQuestions: number;
  totalMinutes: number;
  stageId: number | null;
  kind: 'Standard' | 'LessonPractice' | 'LessonAssessment';
  origin: 'ZipImport' | 'AiPipeline';
  storagePath: string | null;
  pendingDeleteAt: string | null;
  createdAt: string;
  updatedAt: string;
  modules: ExamModuleSummary[];
  curriculumLinks: ExamTypeCurriculumLinkSummary[];
}

export interface DeclaredModuleInput {
  name: string;
  questionCount: number;
}

export interface CreateExamTypeFromZipInput {
  name: string;
  description?: string;
  totalQuestions: number;
  totalMinutes: number;
  stageId: number;
  modules: DeclaredModuleInput[];
}

/** `GET /api/exam-types`. */
export function listExamTypes(): Promise<ExamTypeSummary[]> {
  return tenantFetch<ExamTypeSummary[]>('/api/exam-types', { method: 'GET' });
}

/** `GET /api/exam-types/:id`. */
export function getExamType(id: string): Promise<ExamTypeSummary> {
  return tenantFetch<ExamTypeSummary>(`/api/exam-types/${encodeURIComponent(id)}`, { method: 'GET' });
}

/** `DELETE /api/exam-types/:id`. */
export function deleteExamType(id: string): Promise<void> {
  return tenantFetch<void>(`/api/exam-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * `POST /api/exam-types/zip` — multipart ZIP upload alongside the declared configuration. Uses the
 * Fetch `FormData` API (this app's client-side equivalent of legacy Angular's `HttpClient` multipart
 * request); `modules` is JSON-encoded into a single text field, matching the Route Handler's own
 * documented wire shape.
 *
 * **Documented UX deviation from legacy**: legacy's Angular client drove a real determinate
 * upload-progress bar via `HttpClient`'s `reportProgress`/`observe: 'events'` option. The Fetch API has
 * no equivalent first-class upload-progress event for a `FormData` body in this app's supported browser
 * matrix, so this client instead surfaces a single indeterminate "Uploading…" state for the whole
 * request duration (see `docs/design/UX_GUIDELINES.md` §20 for the full UI-state writeup) — a smaller,
 * still-complete UX than legacy's, not a functional gap (the upload itself is byte-identical).
 */
export function createExamTypeFromZip(input: CreateExamTypeFromZipInput, file: File): Promise<ExamTypeSummary> {
  const formData = new FormData();
  formData.append('name', input.name);
  if (input.description) formData.append('description', input.description);
  formData.append('totalQuestions', String(input.totalQuestions));
  formData.append('totalMinutes', String(input.totalMinutes));
  formData.append('stageId', String(input.stageId));
  formData.append('modules', JSON.stringify(input.modules));
  formData.append('file', file);

  return tenantFetch<ExamTypeSummary>('/api/exam-types/zip', { method: 'POST', body: formData });
}
