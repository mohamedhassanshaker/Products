export { UserEntity } from './user.entity';
export { RoleEntity } from './role.entity';
export { PermissionEntity } from './permission.entity';
export { OutboxMessageEntity } from './outbox-message.entity';
export { ProcessedEventEntity } from './processed-event.entity';
export { FileCleanupQueueEntity } from './file-cleanup-queue.entity';
export { EducationLevelEntity } from './education-level.entity';
export { StageEntity } from './stage.entity';
export { SubjectEntity } from './subject.entity';
export { CurriculumEntity } from './curriculum.entity';
export { ExamTypeEntity } from './exam-type.entity';
export { ExamModuleEntity } from './exam-module.entity';
export { ExamTypeQuestionEntity } from './exam-type-question.entity';
export { AiCallLogEntity } from './ai-call-log.entity';
export { PdfProcessingSessionEntity } from './pdf-processing-session.entity';
export { GeneratedQuestionEntity } from './generated-question.entity';
export { CurriculumDocumentEntity } from './curriculum-document.entity';
export { StoredImageEntity } from './stored-image.entity';
export { QuestionImageEntity } from './question-image.entity';
export { ExamTypeCurriculumEntity } from './exam-type-curriculum.entity';
export { IdempotencyKeyEntity } from './idempotency-key.entity';
export { AttemptEntity } from './attempt.entity';
export { AttemptQuestionEntity } from './attempt-question.entity';
export { PracticeSessionEntity } from './practice-session.entity';
export type { PracticeSessionKind, PracticeSessionStatus } from './practice-session.entity';
export { PracticeQuestionEntity } from './practice-question.entity';
export type { PracticeQuestionSource } from './practice-question.entity';

/**
 * Tenant-schema entity barrel — every entity here maps a table `migrations/tenant/**` already
 * created. `user_role`/`role_permission` are deliberately **not** modeled as TypeORM entities
 * (`RoleEntity.permissions`'s `@JoinTable` covers `role_permission` declaratively; `user_role` has no
 * entity at all) — matching legacy's own convention of raw-SQL access for the pure join tables that
 * have no columns beyond their composite key, avoiding a bidirectional `UserEntity` ↔ `RoleEntity`
 * relation neither module needs.
 *
 * `OutboxMessageEntity`/`ProcessedEventEntity`/`FileCleanupQueueEntity` (Phase 1 sub-slice 1c) map
 * `migrations/tenant/20260815000002-create-reliability-tables.ts`'s tables — `server/reliability`'s
 * repositories are their sole consumers.
 *
 * `EducationLevelEntity`/`StageEntity`/`SubjectEntity` (Phase 3) map
 * `migrations/tenant/20260815000003-create-taxonomy-tables.ts`'s tables — `server/taxonomy`'s
 * repositories are their sole consumers. `CurriculumEntity` (Phase 3) maps
 * `migrations/tenant/20260815000004-create-curriculum-table.ts`'s table — `server/curricula`'s
 * repository is its sole consumer. `CurriculumDocumentEntity` (Phase 6, sub-slice "6b") maps
 * `migrations/tenant/20260815000008-create-curriculum-document-and-media-tables.ts`'s
 * `curriculum_document` table — Phase 3 deliberately deferred it until its first real writers existed
 * (`server/curricula`'s document-upload ingestion and `server/pdf-processing`'s Reference-indexing
 * branch), see `docs/plans/nextjs-rewrite-phase3-plan.md`'s scope-split write-up.
 *
 * `ExamTypeEntity`/`ExamModuleEntity`/`ExamTypeQuestionEntity` (Phase 4) map
 * `migrations/tenant/20260815000005-create-exam-authoring-tables.ts`'s tables — `server/exam-authoring`'s
 * repository is their sole consumer. `exam_type_curriculum` (and its entity) is deliberately NOT part of
 * this phase's schema — see `docs/plans/nextjs-rewrite-phase4-plan.md`'s judgment-call section (its real
 * writer is Phase 6's PDF-processing finalize flow, not manual ZIP authoring).
 *
 * `AiCallLogEntity` (Phase 5) maps `migrations/tenant/20260815000006-create-ai-call-log-table.ts`'s
 * table -- `server/ai`'s `AiCallLogRepository`/`PersistentAiUsageRecorder` are its sole consumers.
 *
 * `StoredImageEntity`/`QuestionImageEntity` (Phase 6, sub-slice "6b") map the same migration's
 * `stored_image`/`question_image` tables — `server/media`'s repositories are their sole consumers
 * (FR-PDF-11/FR-FILE-3's content-hash-deduped, reference-counted image storage/association).
 *
 * `AttemptEntity`/`AttemptQuestionEntity` (Phase 7) map
 * `migrations/tenant/20260815000010-create-attempt-tables.ts`'s `attempt`/`attempt_question` tables —
 * `server/attempts`'s `AttemptsRepository` is their sole consumer. `attempt`'s `active_key` `STORED
 * GENERATED` column (backing `uq_attempt_active`, FR-TAKE-2's single-in-progress-attempt invariant) is
 * deliberately NOT mapped on `AttemptEntity` — see that entity's own doc comment.
 *
 * `PracticeSessionEntity`/`PracticeQuestionEntity` (Phase 8) map
 * `migrations/tenant/20260815000011-create-practice-tables.ts`'s `practice_session`/`practice_question`
 * tables — `server/practice`'s `PracticeSessionRepository` is their sole consumer. Distinct from the
 * `attempt`/`attempt_question` table family: a practice session has no timer/deadline/submit lifecycle.
 */
