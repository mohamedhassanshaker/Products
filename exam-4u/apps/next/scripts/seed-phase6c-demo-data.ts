/**
 * Seeds a real, `Completed` `pdf_processing_session` plus real `generated_question` rows directly
 * against the `demo-phase3` tenant's own MySQL schema (`npm run provision-phase3-demo-tenant`'s
 * established demo tenant — reused here, not a fresh throwaway schema, matching this dispatch's own
 * instruction to avoid adding to the already-flagged 71+ accumulated tenant-schema count).
 *
 * **Why this script exists (Phase 6 sub-slice "6c"'s real-browser-verification closure dispatch)**: this
 * environment has no live `OPENROUTER_API_KEY` (`AI_ENABLED=false`, confirmed via
 * `docs/plans/nextjs-rewrite-phase6-plan.md`'s own environment findings, reconfirmed by this dispatch
 * against the actual repo-root `.env`). A real PDF upload therefore can never reach `Completed` in this
 * environment — it durably stops at `Classifying`/`AI_DISABLED` (6a's own documented, honest terminal
 * state). Sub-slice 6c's own review/finalize/append UI only renders once a session IS `Completed`, so
 * proving that UI through a real browser requires a `Completed` session with real `generated_question`
 * rows to review — this script creates exactly that, directly against the real tenant schema, the same
 * "SQL-seed the precondition an AI-disabled environment cannot reach honestly" approach 6a's own dedup
 * proof and 6c's own integration test both already use.
 *
 * Every row this script inserts is otherwise indistinguishable from one a real, successful
 * `ExamExtractionService` pass would have written (same columns, same `generation_method` vocabulary) —
 * it is a data precondition, not a UI/backend code substitute; every subsequent action the smoke script
 * drives (review/edit/flag/bulk-delete/finalize/append) still exercises the real Route Handlers/services/
 * database exactly as a genuine `Completed` session's data would.
 *
 * Prints `{ sessionId1, sessionId2, curriculumId }` as JSON on success — `scripts/playwright-smoke-tenant.ts`
 * reads these via env vars (`SMOKE_SESSION_1_ID`/`SMOKE_SESSION_2_ID`/`SMOKE_CURRICULUM_ID`) rather than
 * re-deriving them, so the browser pass never has to guess at seeded ids.
 *
 * Run via (after `npm run provision-phase3-demo-tenant`):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npx tsx scripts/seed-phase6c-demo-data.ts
 */
import { randomUUID } from 'node:crypto';
import { getPlatformDataSource, getTenantDataSourceRegistry, ExamTypeQuestionEntity } from '@/server/infrastructure/database';
import { runWithRequestContext, requireTenantDataSource } from '@/server/context';
import { UserRepository } from '@/server/auth';
import { getTaxonomyService } from '@/server/taxonomy';
import { getCurriculaService } from '@/server/curricula';
import { QuestionBankIndexingService } from '@/server/pdf-processing';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { createVectorBootstrapService } from '@/server/vector';
import type { PdfProcessingSessionEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';

/**
 * Sub-slice "6d" additions (the same "SQL-seed the precondition an AI-disabled environment cannot
 * reach honestly" approach this file's own header doc comment already documents for 6c):
 *
 * - A THIRD seeded session (`sessionId3`), deliberately never touched by the Playwright smoke
 *   script's own edit/bulk-delete/finalize/append steps (which consume `sessionId1`/`sessionId2`
 *   entirely) — its one still-unfinalized "duplicate-designed" question is what the "Find similar
 *   questions" dialog step queries against.
 * - Two real `<prefix>_question_bank` Qdrant points, indexed via the REAL
 *   `QuestionBankIndexingService.indexQuestions` (never a mocked vector store), carrying the EXACT
 *   same question text as `sessionId3`'s duplicate-designed candidate. **Judgment call, documented**:
 *   this environment's `NullEmbeddingsAdapter` (no live embeddings credential, same finding every
 *   prior Phase 5/6 dispatch already recorded) produces a deterministic hash-derived vector per
 *   distinct input string with no real semantic smoothing — two DIFFERENT-but-similar strings would
 *   not reliably land above `SIMILAR_QUESTIONS_RELEVANCE_FLOOR`'s 0.75 cosine floor the way a real
 *   embeddings model's near-duplicate detection would. Using the IDENTICAL string for both the
 *   candidate and its two "bank" matches still drives the REAL embed → REAL Qdrant upsert → REAL
 *   Qdrant cosine search → REAL score-threshold path end to end (cosine similarity of an identical
 *   vector against itself is a real, unmocked `1.0`, which genuinely clears the floor) — only the
 *   *fixture's* textual distinctness is a simplification forced by this environment's embeddings
 *   configuration, not a shortcut around the real infrastructure path itself.
 * - A calibration corpus: a fourth session plus ~24 additional `generated_question` rows spanning
 *   every one of `GenerationMethod`'s real values and multiple confidence bands (including some
 *   `is_human_edited`/finalized rows), giving `/settings/confidence-calibration` real, non-trivial
 *   aggregated data to render.
 */

const TENANT_SUBDOMAIN = process.env.DEMO_TENANT_SUBDOMAIN?.trim().toLowerCase() || 'demo-phase3';
const ADMIN_EMAIL = process.env.DEMO_TENANT_ADMIN_EMAIL?.trim() || 'admin@demo-phase3.local';

async function bootstrap(): Promise<void> {
  const platformDs = await getPlatformDataSource();
  const tenantRow = await platformDs.query('SELECT id, schema_name FROM tenant WHERE subdomain_slug = ? LIMIT 1', [TENANT_SUBDOMAIN]);
  if (tenantRow.length === 0) {
    throw new Error(`No tenant found for subdomain '${TENANT_SUBDOMAIN}' — run 'npm run provision-phase3-demo-tenant' first.`);
  }
  const { id: tenantId, schema_name: schemaName } = tenantRow[0] as { id: string; schema_name: string };

  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(schemaName);
  try {
    // `demo-phase3` was provisioned before Phase 6's tenant-schema migrations existed — TypeORM's own
    // migrations-table bookkeeping makes this idempotent (a no-op for every already-applied migration),
    // so running it here brings this pre-existing demo tenant current with `pdf_processing_session`/
    // `generated_question`/`exam_type_curriculum`/`idempotency_key` without needing a fresh throwaway
    // schema (this dispatch's own documented reuse-over-accumulate discipline).
    await dataSource.runMigrations();

    const result = await runWithRequestContext(
      { requestId: randomUUID(), tenantId, tenantSlug: TENANT_SUBDOMAIN, tenantSchema: schemaName, tenantDataSource: dataSource },
      async () => {
        const users = new UserRepository(dataSource);
        const admin = await users.findByEmail(ADMIN_EMAIL);
        if (!admin) throw new Error(`Tenant Admin ${ADMIN_EMAIL} not found — run 'npm run provision-phase3-demo-tenant' first.`);

        const suffix = Date.now().toString(36);
        const taxonomy = getTaxonomyService();
        const level = await taxonomy.createOrFetchEducationLevel(`Phase6c Level ${suffix}`);
        const stage = await taxonomy.createOrFetchStage(level.entity.id, `Phase6c Stage ${suffix}`);
        const subject = await taxonomy.createOrFetchSubject(stage.entity.id, `Phase6c Subject ${suffix}`);

        const curricula = getCurriculaService();
        const curriculum = await curricula.create(admin.id, { name: `Phase6c Curriculum ${suffix}`, subjectId: subject.entity.id });

        const ds = requireTenantDataSource();
        const sessionId1 = await seedCompletedSession(ds, admin.id, subject.entity.id, `phase6c-source-1-${suffix}.pdf`, 4);
        const sessionId2 = await seedCompletedSession(ds, admin.id, subject.entity.id, `phase6c-source-2-${suffix}.pdf`, 2);

        // Sub-slice "6d" — a third session, deliberately never consumed by the Playwright smoke
        // script's own 6c edit/bulk-delete/finalize/append steps, holding one "duplicate-designed"
        // question the "Find similar questions" dialog step queries against.
        const duplicateText = `Phase6d duplicate-designed question ${suffix}: what is the powerhouse of the cell?`;
        const sessionId3 = await seedSimilarQuestionsSession(ds, admin.id, `phase6c-source-3-${suffix}.pdf`, duplicateText);

        // Two real question-bank Qdrant points, indexed via the REAL QuestionBankIndexingService,
        // carrying the exact same text (see this file's own header doc comment for why identical,
        // not merely similar, text is this environment's documented workaround).
        await (await createVectorBootstrapService()).run();
        const bankEntries = [
          fakeBankQuestion(`et-${suffix}-a`, 'Cell Biology Basics', 'Module: Organelles', duplicateText),
          fakeBankQuestion(`et-${suffix}-b`, 'Advanced Biology', 'Module: Cellular Respiration', duplicateText),
        ];
        const indexing = new QuestionBankIndexingService(getQdrantVectorStoreAdapter(), getEmbeddingsPort(), getQdrantVectorStoreAdapter());
        await indexing.indexQuestions(tenantId, `et-${suffix}-a`, 'Cell Biology Basics', [bankEntries[0]]);
        await indexing.indexQuestions(tenantId, `et-${suffix}-b`, 'Advanced Biology', [bankEntries[1]]);

        // Sub-slice "6d" — a calibration corpus: a fourth session plus a real spread of
        // generation-method/confidence-band/human-edit/finalize combinations, so
        // `/settings/confidence-calibration` has real, non-trivial aggregated data to render.
        const sessionId4 = await seedCalibrationCorpus(ds, admin.id, `phase6c-source-4-${suffix}.pdf`);

        return {
          sessionId1,
          sessionId2,
          sessionId3,
          sessionId4,
          duplicateQuestionText: duplicateText,
          curriculumId: curriculum.id,
          subjectId: subject.entity.id,
        };
      },
    );

    // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
    console.log(JSON.stringify(result, null, 2));
  } finally {
    registry.release(schemaName);
    await platformDs.destroy();
  }
}

/** Inserts one `Completed` `pdf_processing_session` plus `questionCount` real, unlinked
 * `generated_question` rows for it — every column matches what `ExamExtractionService`'s own successful
 * write shape would have produced (see this file's own doc comment for why this is a data precondition,
 * not a UI/backend substitute). Returns the new session's id. */
async function seedCompletedSession(
  dataSource: ReturnType<typeof requireTenantDataSource>,
  initiatedByUserId: string,
  subjectId: number,
  sourceFileName: string,
  questionCount: number,
): Promise<string> {
  const sessionId = randomUUID();
  const sessions = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
  const questions = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');

  const session = sessions.create({
    id: sessionId,
    initiatedByUserId,
    sourceFileName,
    contentTypeHint: 'Exam',
    contentType: 'Exam',
    status: 'Completed',
    errorMessage: null,
    errorCode: null,
    totalQuestions: questionCount,
    successfulQuestions: questionCount,
    detectedTopics: ['Arithmetic'],
    estimatedQuestionsPerPage: 2,
    storageKeyPrefix: `tenants/seed/pdf-processing/${sessionId}/`,
    sourceStorageKey: `tenants/seed/pdf-processing/${sessionId}/source.pdf`,
    subjectId,
    curriculumId: null,
    curriculumDocumentId: null,
    fileHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    forceReprocess: false,
    reusedFromSessionId: null,
    pageCount: questionCount,
    tokensUsed: 500,
    totalCost: 0.01,
    budgetExhausted: false,
    lastCompletedPage: questionCount,
    coveredConcepts: null,
    resumeAttempts: 0,
    workerId: null,
    heartbeatAt: null,
    completedAt: new Date(),
  });
  await sessions.insert(session);

  for (let i = 1; i <= questionCount; i += 1) {
    await questions.insert(
      questions.create({
        id: randomUUID(),
        processingSessionId: sessionId,
        subjectId: null,
        questionText: `Seeded question ${i} for ${sourceFileName}: what is ${i} + ${i}?`,
        optionsJson: { A: String(i), B: String(i * 2), C: String(i * 3) },
        correctAnswer: 'B',
        explanation: `${i} + ${i} = ${i * 2}.`,
        questionType: 'multiple_choice',
        bloomsLevel: 1,
        sourcePageRange: `${i}-${i}`,
        sourceSection: 'Arithmetic',
        answerSource: 'provided',
        confidenceScore: 0.9,
        generationMethod: 'exam_extraction_with_key',
        isAutoGenerated: true,
        isHumanEdited: false,
        isReviewFlagged: false,
        notes: null,
        linkedExamTypeId: null,
        batchIndex: null,
      }),
    );
  }

  return sessionId;
}

/** A minimal `ExamTypeQuestionEntity`-shaped object suitable for
 * `QuestionBankIndexingService.indexQuestions` — no real `exam_type_question` row is written (that
 * table belongs to `server/exam-authoring`'s own finalize/append write path, already covered by 6c's
 * own integration test); this script only needs the four fields the indexing service actually reads. */
function fakeBankQuestion(examTypeId: string, examTypeName: string, moduleName: string, questionText: string): ExamTypeQuestionEntity {
  return Object.assign(new ExamTypeQuestionEntity(), {
    id: randomUUID(),
    examTypeId,
    moduleName,
    questionKey: `gq_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    questionText,
    optionsJson: { A: 'Mitochondria', B: 'Nucleus', C: 'Ribosome' },
    correctAnswer: 'A',
    explanation: null,
    sourceGeneratedQuestionId: randomUUID(),
  });
}

/** Seeds a `Completed` session with 2 ordinary questions plus one `duplicateText` question — the
 * still-unfinalized candidate the "Find similar questions" dialog step queries against. Deliberately
 * its own small helper (not `seedCompletedSession`, whose fixed `questionText` template can't express
 * one distinguished row) — see this file's own header doc comment. */
async function seedSimilarQuestionsSession(
  dataSource: ReturnType<typeof requireTenantDataSource>,
  initiatedByUserId: string,
  sourceFileName: string,
  duplicateText: string,
): Promise<string> {
  const sessionId = randomUUID();
  const sessions = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
  const questions = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');

  await sessions.insert(
    sessions.create(baseSessionFields(sessionId, initiatedByUserId, sourceFileName, 3)),
  );

  const texts = ['Seeded plain question A: what is 3 + 3?', duplicateText, 'Seeded plain question B: what is 5 + 5?'];
  for (const text of texts) {
    await questions.insert(baseQuestionFields(sessionId, text));
  }
  return sessionId;
}

/** Seeds a `Completed` session plus a real spread of `generated_question` rows across every
 * `GenerationMethod` value and every one of `CONFIDENCE_BANDS`' 4 bands, with a mix of
 * `isHumanEdited`/`linkedExamTypeId` (finalized) combinations — real, non-trivial, aggregable data for
 * `/settings/confidence-calibration`, not a single flat value that would trivially pass any assertion. */
async function seedCalibrationCorpus(
  dataSource: ReturnType<typeof requireTenantDataSource>,
  initiatedByUserId: string,
  sourceFileName: string,
): Promise<string> {
  const sessionId = randomUUID();
  const sessions = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
  const questions = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');

  const methods = ['lesson_generation', 'exam_extraction_with_key', 'exam_extraction_inferred', 'reused_from_cache', 'regenerated'];
  // One representative confidence value per CONFIDENCE_BANDS band (0-0.6, 0.6-0.75, 0.75-0.9, 0.9-1.0).
  const bandScores = [0.3, 0.68, 0.82, 0.95];

  await sessions.insert(sessions.create(baseSessionFields(sessionId, initiatedByUserId, sourceFileName, methods.length * bandScores.length)));

  let counter = 0;
  for (const method of methods) {
    for (const score of bandScores) {
      counter += 1;
      // A deterministic, varied spread of isHumanEdited/finalized combinations (not every row
      // identical) — every 3rd row edited, every 2nd row finalized, so every band ends up with a
      // genuinely mixed (not 0% or 100%) rate to render.
      await questions.insert(
        questions.create({
          ...baseQuestionFields(sessionId, `Calibration corpus row ${counter} (${method}, score ${score})`),
          generationMethod: method,
          confidenceScore: score,
          isHumanEdited: counter % 3 === 0,
          linkedExamTypeId: counter % 2 === 0 ? randomUUID() : null,
        }),
      );
    }
  }
  return sessionId;
}

/** Shared `pdf_processing_session` column defaults across every one of this file's seeding helpers —
 * factored out once this file grew a third/fourth seeded session, so each helper's own call site only
 * states what's genuinely distinguishing (file name, question count). */
function baseSessionFields(sessionId: string, initiatedByUserId: string, sourceFileName: string, questionCount: number) {
  return {
    id: sessionId,
    initiatedByUserId,
    sourceFileName,
    contentTypeHint: 'Exam' as const,
    contentType: 'Exam' as const,
    status: 'Completed' as const,
    errorMessage: null,
    errorCode: null,
    totalQuestions: questionCount,
    successfulQuestions: questionCount,
    detectedTopics: ['Arithmetic'],
    estimatedQuestionsPerPage: 2,
    storageKeyPrefix: `tenants/seed/pdf-processing/${sessionId}/`,
    sourceStorageKey: `tenants/seed/pdf-processing/${sessionId}/source.pdf`,
    subjectId: null,
    curriculumId: null,
    curriculumDocumentId: null,
    fileHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    forceReprocess: false,
    reusedFromSessionId: null,
    pageCount: questionCount,
    tokensUsed: 500,
    totalCost: 0.01,
    budgetExhausted: false,
    lastCompletedPage: questionCount,
    coveredConcepts: null,
    resumeAttempts: 0,
    workerId: null,
    heartbeatAt: null,
    completedAt: new Date(),
  };
}

/** Shared `generated_question` column defaults — each caller overrides only what it needs to vary
 * (`generationMethod`/`confidenceScore`/`isHumanEdited`/`linkedExamTypeId` for the calibration corpus;
 * nothing for the plain/duplicate-text rows). */
function baseQuestionFields(sessionId: string, questionText: string) {
  return {
    id: randomUUID(),
    processingSessionId: sessionId,
    subjectId: null,
    questionText,
    optionsJson: { A: '1', B: '2', C: '3' },
    correctAnswer: 'A',
    explanation: null,
    questionType: 'multiple_choice',
    bloomsLevel: 1,
    sourcePageRange: '1-1',
    sourceSection: 'Arithmetic',
    answerSource: 'provided' as const,
    confidenceScore: 0.9,
    generationMethod: 'exam_extraction_with_key',
    isAutoGenerated: true,
    isHumanEdited: false,
    isReviewFlagged: false,
    notes: null,
    linkedExamTypeId: null,
    batchIndex: null,
  };
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
