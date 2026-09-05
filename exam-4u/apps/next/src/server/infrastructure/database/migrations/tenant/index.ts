import { CreateRbacTables20260815000001 } from './20260815000001-create-rbac-tables';
import { CreateReliabilityTables20260815000002 } from './20260815000002-create-reliability-tables';
import { CreateTaxonomyTables20260815000003 } from './20260815000003-create-taxonomy-tables';
import { CreateCurriculumTable20260815000004 } from './20260815000004-create-curriculum-table';
import { CreateExamAuthoringTables20260815000005 } from './20260815000005-create-exam-authoring-tables';
import { CreateAiCallLogTable20260815000006 } from './20260815000006-create-ai-call-log-table';
import { CreatePdfProcessingTables20260815000007 } from './20260815000007-create-pdf-processing-tables';
import { CreateCurriculumDocumentAndMediaTables20260815000008 } from './20260815000008-create-curriculum-document-and-media-tables';
import { CreateExamTypeCurriculumAndIdempotencyKeyTables20260815000009 } from './20260815000009-create-exam-type-curriculum-and-idempotency-key-tables';
import { CreateAttemptTables20260815000010 } from './20260815000010-create-attempt-tables';
import { CreatePracticeTables20260815000011 } from './20260815000011-create-practice-tables';

/**
 * The tenant migration set applied identically to every tenant schema by
 * `TenantDataSourceFactory`/`RunMigrationsStep` — never on app boot (HLD §4.5 equivalent: CLI/
 * provisioning-time only).
 *
 * Sub-slice 1a shipped identity/RBAC only; sub-slice 1c appended the reliability tables
 * (`outbox_message`/`processed_event`/`file_cleanup_queue`). Phase 3 appended the taxonomy tables
 * (`education_level`/`stage`/`subject`, plus the `fk_user_edu` FK closing sub-slice 1a's own forward
 * reference) and `curriculum` (ownership/metadata only — `curriculum_document` is deliberately
 * deferred, see `docs/plans/nextjs-rewrite-phase3-plan.md`). Phase 4 (this dispatch) appends the
 * manual-ZIP exam-authoring tables (`exam_type`/`exam_module`/`exam_type_question` — `exam_type_
 * curriculum` deliberately deferred to Phase 6, see `docs/plans/nextjs-rewrite-phase4-plan.md`'s
 * judgment-call section). Order matters here: `CreateExamAuthoringTables20260815000005` FKs `stage`, so
 * `CreateTaxonomyTables20260815000003` must apply first — the array order below is also each
 * migration's actual apply order (TypeORM applies migrations in array order, not just by
 * timestamp-in-filename). Phase 5 appends `ai_call_log` (`server/ai`'s cost/usage accounting sink) --
 * no FK dependency on anything above, appended last. Phase 6 sub-slice "6a" (this dispatch) appends
 * `pdf_processing_session`/`generated_question` (`CreatePdfProcessingTables20260815000007` FKs
 * `subject`, already created by `CreateTaxonomyTables20260815000003`) — `idempotency_key` and
 * `session_kind`/full-bank-assessment columns are deliberately deferred, see that migration's own doc
 * comment. Attempts, media, and practice tables all belong to their own later migration-plan phases
 * (7/8), matching legacy's own phased migration history. Phase 6 sub-slice "6b" appends
 * `curriculum_document`/`stored_image`/`question_image` (`CreateCurriculumDocumentAndMediaTables20260815000008`
 * FKs `curriculum` from `...000004` and `generated_question` from `...000007`, both already applied above)
 * — `curriculum_document` closes Phase 3's own documented deferral now that its first real writers
 * (Curriculum document ingestion + the Reference-indexing branch) exist. Phase 7 appends
 * `attempt`/`attempt_question` (`CreateAttemptTables20260815000010`, no FK dependency on anything
 * above — `exam_type_id`/`user_id` are deliberately soft references, see that migration's own doc
 * comment) — this closes `ExamAuthoringRepository.hasActiveAttempts`'s Phase 4-era stub forward
 * reference. Later phases append their own tenant migrations here.
 */
export const TENANT_MIGRATIONS = [
  CreateRbacTables20260815000001,
  CreateReliabilityTables20260815000002,
  CreateTaxonomyTables20260815000003,
  CreateCurriculumTable20260815000004,
  CreateExamAuthoringTables20260815000005,
  CreateAiCallLogTable20260815000006,
  CreatePdfProcessingTables20260815000007,
  CreateCurriculumDocumentAndMediaTables20260815000008,
  CreateExamTypeCurriculumAndIdempotencyKeyTables20260815000009,
  CreateAttemptTables20260815000010,
  CreatePracticeTables20260815000011,
];
