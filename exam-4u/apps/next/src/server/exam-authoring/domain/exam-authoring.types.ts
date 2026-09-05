/** One module's declared shape in a `POST /exam-types/zip` request body (LLD §7.3: "`modules[]`").
 * `questionCount` here is the authored *target/quota* (FR-AUTH-3: "the sum of module counts governs how
 * an attempt is assembled") — it is not required to equal the number of `.json` files actually found
 * under that module's ZIP folder before content-level reconciliation (see
 * `assertActualMatchesDeclaredModuleCounts` in the application service); FR-AUTH-3 explicitly defers
 * quota-vs-bank-size reconciliation to attempt-generation time (FR-TAKE-3, a later phase), not
 * authoring time. */
export interface DeclaredModuleInput {
  name: string;
  questionCount: number;
}

/** `ExamAuthoringService.createFromZip`'s input — the parsed multipart request (LLD §7.3
 * `POST /exam-types/zip`), already shape-validated by the Route Handler. */
export interface CreateExamTypeFromZipInput {
  name: string;
  description?: string;
  totalQuestions: number;
  totalMinutes: number;
  stageId: number;
  modules: DeclaredModuleInput[];
}

/** A summary of one persisted `exam_module` row. */
export interface ExamModuleSummary {
  id: string;
  moduleName: string;
  questionCount: number;
}

/** A summary of one `exam_type_curriculum` row linking an Exam Type to a Curriculum (FR-AUTH-4). Added
 * during Phase 6 sub-slice "6c"'s real-browser closure pass — the write side already existed
 * (`FinalizeExamService.finalize`), but nothing read it back until this dispatch. `curriculumName` is
 * resolved server-side (never a raw id-only reference) so the UI can render it without a second
 * round trip. */
export interface ExamTypeCurriculumLinkSummary {
  curriculumId: string;
  curriculumName: string;
  contextWeight: number;
  applicableModules: string[] | null;
}

/** A summary of one persisted `exam_type` row, including its declared modules. Matches legacy's
 * `ExamAuthoringService.toSummary` shape verbatim — no separate "actual stored" per-module count field
 * exists on the wire (see `ExamModuleSummary`'s own doc comment history in `legacy/web`'s
 * `exam-types.service.ts` for why: the persisted `questionCount` is already derived from the ZIP's real
 * parsed content, see `buildInsert`, so there is nothing further to reconcile on read). */
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
  pendingDeleteAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  modules: ExamModuleSummary[];
  /** Curricula linked via FR-AUTH-4 (`exam_type_curriculum`), if any — always `[]` for a `ZipImport`-
   * origin Exam Type (that creation path has no Curriculum-linking step). */
  curriculumLinks: ExamTypeCurriculumLinkSummary[];
}
