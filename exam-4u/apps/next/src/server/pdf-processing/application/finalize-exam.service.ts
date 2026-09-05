import { randomUUID } from 'node:crypto';
import { requireTenantId } from '@/server/context';
import { ExamModuleEntity, ExamTypeCurriculumEntity, ExamTypeEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';
import { ExamTypeNameExistsError, type ExamTypeCurriculumLinkSummary, type ExamTypeSummary } from '@/server/exam-authoring';
import { CurriculumNotFoundError, type CurriculaRepository } from '@/server/curricula';
import type { SubjectRepository } from '@/server/taxonomy';
import { isDuplicateKeyError } from '../infrastructure/mysql-error.util';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { FinalizeExamRepository, type FinalizeInsert } from '../infrastructure/finalize-exam.repository';
import { InvalidContextWeightError, NoEligibleQuestionsError, PdfProcessingSessionNotFoundError } from '../domain/errors';
import type { FinalizeExamInput } from '../domain/pdf-processing.types';
import { groupIntoModules } from '../domain/group-into-modules';
import { QuestionBankIndexingService } from './question-bank-indexing.service';

const MIN_CONTEXT_WEIGHT = 1;
const MAX_CONTEXT_WEIGHT = 10;

/**
 * FR-PDF-9's finalize business logic (migration plan Phase 6, sub-slice "6c", LLD §8.5). Ported logic
 * from `legacy/api/src/modules/pdf-processing/application/finalize-exam.service.ts`, adapted to this
 * app's plain-class composition convention. Its own collaborator (not folded into
 * `QuestionReviewService` or `PdfProcessingService`) — finalize is a genuinely distinct concern (creates
 * a brand-new, live `ExamType`, never mutates `generated_question` content the way review/edit does).
 *
 * **`NO_ELIGIBLE_QUESTIONS` before any write (FR-PDF-9)**: {@link finalize} runs
 * `GeneratedQuestionRepository.findEligibleForFinalize` and throws before constructing (let alone
 * persisting) a single `ExamTypeEntity` if it comes back empty — there is no code path that could ever
 * leave an empty Exam Type behind.
 *
 * **Module grouping (FR-PDF-9: "grouped into modules by their detected source section", LLD §8.5)** —
 * delegated to {@link groupIntoModules} (`domain/group-into-modules.ts`), shared verbatim with
 * `AppendExamService` — see that function's own doc comment for the "declared `modules[]` vs raw
 * `source_section`" judgment call.
 *
 * **`stage_id` resolution (documented judgment call, `ExamTypeEntity.stage_id` is nullable exactly for
 * this AI-pipeline path)**: prefers the session's own `subjectId` (set by the uploader at
 * `POST /pdf-processing/upload` time) if present; otherwise falls back to the first eligible question's
 * own FR-PDF-7-classified `subjectId`; otherwise leaves `stage_id` `null` rather than guessing.
 *
 * **`total_questions` derivation (mirrors `ExamAuthoringService.buildInsert`'s identical "stored value
 * always reflects reality, never the caller's claim" convention)**: `exam_type.total_questions` is
 * always the actual number of eligible questions being finalized, not the caller-supplied
 * `FinalizeExamInput.totalQuestions` verbatim.
 *
 * **Best-effort question-bank index write** happens here, via {@link
 * QuestionBankIndexingService.indexQuestions} — called *after* {@link
 * FinalizeExamRepository.finalize}'s transaction has already committed, and never allowed to fail this
 * method (see that service's own "best-effort, never throws" doc comment). See
 * `QuestionBankIndexingService`'s own doc comment for why this dispatch built the writer earlier than
 * originally planned.
 *
 * **Correction (found during Phase 8 closure's real-browser verification)**: this call is `await`ed
 * inline, NOT dispatched fire-and-forget (which would require re-acquiring a fresh tenant/ALS scope the
 * way `PdfProcessingService`'s background reschedule path does — see that module's own "Decisions
 * made" #5 — since this HTTP response would otherwise complete and tear down the request-scoped
 * context before a truly detached call finished). `indexQuestions` itself never throws (logged and
 * swallowed on failure), so this can never fail the finalize response, but it CAN make it slower: in an
 * environment whose embeddings provider is configured but unreachable (this environment's own
 * documented `next start` constraint — see `docs/plans/nextjs-rewrite-phase6-plan.md`'s "Decisions
 * made" #10 for why `EMBEDDINGS_PROVIDER=null`'s `NullEmbeddingsAdapter` cannot be used under `next
 * start`), the real embeddings-adapter connect-timeout (10s) genuinely adds to this method's own
 * response latency rather than failing fast. Left as an honestly-documented, real latency
 * characteristic (not fixed by detaching the call) — doing so safely is a larger, separate change
 * outside a verification-only dispatch's scope; flagged here for whichever future dispatch touches this
 * path next.
 */
export class FinalizeExamService {
  constructor(
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly subjects: SubjectRepository,
    private readonly curricula: CurriculaRepository,
    private readonly finalizeRepository: FinalizeExamRepository,
    private readonly questionBankIndexing: QuestionBankIndexingService,
  ) {}

  /**
   * @throws {PdfProcessingSessionNotFoundError} if no such session exists.
   * @throws {NoEligibleQuestionsError} if no question in the session meets `minConfidence` (and, if
   *   requested, `autoGeneratedOnly`).
   * @throws {InvalidContextWeightError} if any `curriculumLinks[].contextWeight` is outside 1-10.
   * @throws {CurriculumNotFoundError} if any `curriculumLinks[].curriculumId` does not exist.
   * @throws {ExamTypeNameExistsError} if `input.examName` is already used by another Exam Type.
   */
  async finalize(sessionId: string, input: FinalizeExamInput): Promise<ExamTypeSummary> {
    const session = await this.requireSession(sessionId);
    await this.validateCurriculumLinks(input.curriculumLinks ?? []);

    const eligible = await this.generatedQuestions.findEligibleForFinalize(sessionId, input.minConfidence, input.autoGeneratedOnly ?? false);
    if (eligible.length === 0) {
      throw new NoEligibleQuestionsError();
    }

    const examTypeId = randomUUID();
    const stageId = await this.resolveStageId(session.subjectId, eligible);
    const examType = buildExamType(examTypeId, input, session.initiatedByUserId, stageId, eligible.length);
    const { modules, questions } = groupIntoModules(examTypeId, eligible, input.modules);
    const curriculumLinks = (input.curriculumLinks ?? []).map((link) => buildCurriculumLink(examTypeId, link));
    // Resolved AFTER validateCurriculumLinks has already proven every id exists — reused here purely to
    // give the immediate finalize response the real, human-readable Curriculum name(s) rather than an
    // empty array the detail page would only fill in on its own next fetch.
    const curriculumLinkSummaries = await this.resolveCurriculumLinkSummaries(input.curriculumLinks ?? []);

    const insert: FinalizeInsert = {
      examType,
      modules,
      questions,
      curriculumLinks,
      finalizedGeneratedQuestionIds: eligible.map((q) => q.id),
    };

    try {
      await this.finalizeRepository.finalize(insert);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ExamTypeNameExistsError();
      }
      throw error;
    }

    // Best-effort question-bank index write (awaited, not detached — see this class's own doc comment
    // "Correction" note for why), only after the real transactional write above has already committed —
    // see `QuestionBankIndexingService`'s own doc comment for why a failure here must never surface as
    // a finalize failure.
    const tenantId = requireTenantId();
    await this.questionBankIndexing.indexQuestions(tenantId, examTypeId, examType.name, questions);

    return toSummary(examType, modules, curriculumLinkSummaries);
  }

  /** Resolves the real Curriculum name for each requested link — every id has already been proven to
   * exist by {@link validateCurriculumLinks}, so this is a read, not a re-validation. */
  private async resolveCurriculumLinkSummaries(
    links: NonNullable<FinalizeExamInput['curriculumLinks']>,
  ): Promise<ExamTypeCurriculumLinkSummary[]> {
    const summaries: ExamTypeCurriculumLinkSummary[] = [];
    for (const link of links) {
      const curriculum = await this.curricula.findById(link.curriculumId);
      if (!curriculum) continue;
      summaries.push({
        curriculumId: link.curriculumId,
        curriculumName: curriculum.name,
        contextWeight: link.contextWeight,
        applicableModules: link.applicableModules ?? null,
      });
    }
    return summaries;
  }

  private async requireSession(id: string) {
    const session = await this.sessions.findById(id);
    if (!session) throw new PdfProcessingSessionNotFoundError();
    return session;
  }

  /** @throws {InvalidContextWeightError} @throws {CurriculumNotFoundError} */
  private async validateCurriculumLinks(links: NonNullable<FinalizeExamInput['curriculumLinks']>): Promise<void> {
    for (const link of links) {
      if (!Number.isInteger(link.contextWeight) || link.contextWeight < MIN_CONTEXT_WEIGHT || link.contextWeight > MAX_CONTEXT_WEIGHT) {
        throw new InvalidContextWeightError(link.contextWeight);
      }
      const curriculum = await this.curricula.findById(link.curriculumId);
      if (!curriculum) throw new CurriculumNotFoundError();
    }
  }

  /** See class doc comment's "`stage_id` resolution" note. */
  private async resolveStageId(sessionSubjectId: number | null, eligible: GeneratedQuestionEntity[]): Promise<number | null> {
    const subjectId = sessionSubjectId ?? eligible.find((q) => q.subjectId !== null)?.subjectId ?? null;
    if (subjectId === null) return null;
    const subject = await this.subjects.findById(subjectId);
    return subject?.stageId ?? null;
  }
}

function buildExamType(
  examTypeId: string,
  input: FinalizeExamInput,
  initiatedByUserId: string | null,
  stageId: number | null,
  actualQuestionCount: number,
): ExamTypeEntity {
  const examType = new ExamTypeEntity();
  examType.id = examTypeId;
  examType.name = input.examName;
  examType.description = input.description ?? null;
  // See class doc comment's "`total_questions` derivation" note: always the real, actual count.
  examType.totalQuestions = actualQuestionCount;
  examType.totalMinutes = input.totalMinutes;
  examType.storagePath = null;
  examType.stageId = stageId;
  examType.storageMode = 'LocalDisk';
  examType.kind = 'Standard';
  examType.origin = 'AiPipeline';
  examType.createdByUserId = initiatedByUserId;
  examType.pendingDeleteAt = null;
  return examType;
}

function buildCurriculumLink(examTypeId: string, link: NonNullable<FinalizeExamInput['curriculumLinks']>[number]): ExamTypeCurriculumEntity {
  const entity = new ExamTypeCurriculumEntity();
  entity.examTypeId = examTypeId;
  entity.curriculumId = link.curriculumId;
  entity.contextWeight = link.contextWeight;
  entity.applicableModulesJson = link.applicableModules ?? null;
  return entity;
}

function toSummary(examType: ExamTypeEntity, modules: ExamModuleEntity[], curriculumLinks: ExamTypeCurriculumLinkSummary[]): ExamTypeSummary {
  return {
    id: examType.id,
    name: examType.name,
    description: examType.description,
    totalQuestions: modules.reduce((sum, m) => sum + m.questionCount, 0),
    totalMinutes: examType.totalMinutes,
    stageId: examType.stageId,
    kind: examType.kind,
    origin: examType.origin,
    storagePath: examType.storagePath,
    pendingDeleteAt: examType.pendingDeleteAt,
    createdAt: examType.createdAt,
    updatedAt: examType.updatedAt,
    modules: modules.map((m) => ({ id: m.id, moduleName: m.moduleName, questionCount: m.questionCount })),
    curriculumLinks,
  };
}
