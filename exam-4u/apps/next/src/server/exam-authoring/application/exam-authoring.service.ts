import { randomUUID } from 'node:crypto';
import { requireTenantId } from '@/server/context';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import type { StoragePort } from '@/server/common/ports/storage.port';
import type { SubjectClassificationResult, SubjectClassificationService } from '@/server/pdf-processing';
import { parseExamZip, InvalidZipStructureError, type ParsedExamZip } from '@/server/infrastructure/zip';
import { ExamAuthoringRepository, type ExamTypeInsert } from '../infrastructure/exam-authoring.repository';
import { isDuplicateKeyError } from '../infrastructure/mysql-error.util';
import { ExamTypeEntity, ExamModuleEntity, ExamTypeQuestionEntity } from '@/server/infrastructure/database';
import type { CurriculaRepository } from '@/server/curricula';
import {
  ExamTypeHasActiveAttemptsError,
  ExamTypeNameExistsError,
  ExamTypeNotFoundError,
  QuestionCountMismatchError,
} from '../domain/errors';
import type { CreateExamTypeFromZipInput, ExamTypeCurriculumLinkSummary, ExamTypeSummary } from '../domain/exam-authoring.types';

/**
 * FR-AUTH-1/FR-AUTH-3/FR-AUTH-5's business logic — ported logic (not code) from
 * `legacy/api/src/modules/exam-authoring/application/exam-authoring.service.ts`'s
 * `ExamAuthoringService`, plus `fixSubjectMapping` (FR-AUTH-6 — real
 * AI-backed, deferred by Phase 4 until `AiServicePort`/`SubjectClassificationService` existed, wired
 * for real in Phase 6 sub-slice "6b"; see that method's own doc comment).
 *
 * **The transactional/storage rollback guarantee (this phase's own exit gate — "no partial artifacts on
 * any validation failure")**: {@link createFromZip} validates *everything* — input self-consistency,
 * then the full ZIP structure/content via `parseExamZip` — entirely in memory, before touching either
 * `StoragePort` or the database. Only once every validation has passed does it write files to storage
 * and then persist to the database inside one transaction (`ExamAuthoringRepository.insertExamType`).
 * If *either* step fails after storage writes have begun (a duplicate name discovered only at the DB's
 * unique-constraint level, or a genuine storage failure partway through writing), the `catch` block
 * deletes the entire per-Exam-Type storage prefix before rethrowing — so a failure at any point after
 * validation still leaves zero storage artifacts, and the DB transaction (having never committed) leaves
 * zero partial rows.
 */
export class ExamAuthoringService {
  constructor(
    private readonly repository: ExamAuthoringRepository,
    private readonly storage: StoragePort,
    private readonly subjectClassification: SubjectClassificationService,
    private readonly curricula: CurriculaRepository,
  ) {}

  /**
   * FR-AUTH-1's full manual-ZIP authoring flow.
   *
   * @throws {QuestionCountMismatchError} if `input.totalQuestions` does not equal the sum of
   *   `input.modules[].questionCount`, or if any declared module's `questionCount` does not equal the
   *   ZIP's actual parsed question count for that module (closing the identical content-level gap
   *   legacy's own QA pass — Dev-12b retry — found and fixed).
   * @throws {InvalidZipStructureError} if `input.modules` is empty, or (via `parseExamZip`) the ZIP is
   *   malformed/unsafe or its top-level folders don't exactly match the declared module names.
   * @throws {EmptyModuleError} (via `parseExamZip`) if a declared module's folder has zero valid
   *   question files.
   * @throws {InvalidQuestionFileError} (via `parseExamZip`) if a question `.json` file is malformed.
   * @throws {ExamTypeNameExistsError} if `input.name` is already used by another Exam Type in this
   *   tenant.
   */
  async createFromZip(actingUserId: string | null, input: CreateExamTypeFromZipInput, zipBuffer: Buffer): Promise<ExamTypeSummary> {
    validateModuleCounts(input);

    // Full validation happens here, entirely in memory — nothing has been written anywhere yet, so
    // every error thrown by `parseExamZip` trivially satisfies "no partial artifacts" (there is nothing
    // to roll back).
    const parsed = await parseExamZip(zipBuffer);
    assertFoldersMatchDeclaredModules(input, parsed);
    // Closes the identical content-level gap legacy's own QA pass found: the checks above only ever
    // compared the request's own declared numbers against each other and the ZIP's folder *names* —
    // never the ZIP's actual parsed question *count* per module against what was declared. Without
    // this, a ZIP declaring 2 questions for a module but actually containing 1 real question file would
    // be silently accepted (exam_type_question would have 1 row while exam_module.question_count stored
    // 2). This is the real, content-level counterpart to `validateModuleCounts`'s pure self-consistency
    // check.
    assertActualMatchesDeclaredModuleCounts(input, parsed);

    const tenantId = requireTenantIdOrInternal();
    const examTypeId = randomUUID();
    const storagePrefix = `tenants/${tenantId}/exam-types/${examTypeId}/`;

    const insert = buildInsert(examTypeId, actingUserId, input, parsed, storagePrefix);

    try {
      // Storage first, DB second (see class doc comment for why): if the DB step fails (most commonly
      // a duplicate-name race lost to a concurrent request), the storage writes made in this same
      // attempt are still cleaned up by the catch block below before rethrowing.
      for (const examModule of parsed.modules) {
        for (const question of examModule.questions) {
          const key = `${storagePrefix}${examModule.moduleName}/${question.sourceFileName}`;
          await this.storage.put(key, question.rawJson, 'application/json');
        }
      }

      await this.repository.insertExamType(insert);
    } catch (error) {
      await this.storage.deletePrefix(storagePrefix);
      if (isDuplicateKeyError(error)) {
        throw new ExamTypeNameExistsError();
      }
      throw error;
    }

    // A brand-new `ZipImport`-origin Exam Type never has Curriculum links (that linking step only
    // exists on the AI-pipeline finalize path) — `[]` here is a real fact, not a placeholder.
    return toSummary(insert.examType, insert.modules, []);
  }

  /** The list view intentionally omits `curriculumLinks` resolution (always `[]` here) — the
   * `/exam-types` list screen has no per-row Curriculum column, so resolving every row's links (and
   * every linked Curriculum's name) on every list load would be pure N+1 cost with no UI consumer. The
   * single-resource {@link get} does resolve them for real, for the one screen that renders them. */
  async list(): Promise<ExamTypeSummary[]> {
    const examTypes = await this.repository.findAll();
    const summaries: ExamTypeSummary[] = [];
    for (const examType of examTypes) {
      const modules = await this.repository.findModules(examType.id);
      summaries.push(toSummary(examType, modules, []));
    }
    return summaries;
  }

  async get(id: string): Promise<ExamTypeSummary> {
    const examType = await this.requireExamType(id);
    const modules = await this.repository.findModules(id);
    const curriculumLinks = await this.resolveCurriculumLinks(id);
    return toSummary(examType, modules, curriculumLinks);
  }

  /** Resolves `exam_type_curriculum` rows into the wire shape the Exam Type detail screen needs
   * (real Curriculum name, not just its id) — see `ExamAuthoringRepository.findCurriculumLinks`'s own
   * doc comment for why this read path did not exist before Phase 6 sub-slice "6c"'s real-browser
   * closure pass. A link whose Curriculum has since been deleted is skipped rather than surfaced with a
   * `null`/placeholder name — `exam_type_curriculum` carries no `ON DELETE` referential action of its
   * own tying it to `curriculum` (LLD §4), so this is a genuine, if rare, orphan-tolerance case, not an
   * expected steady-state condition. */
  private async resolveCurriculumLinks(examTypeId: string): Promise<ExamTypeCurriculumLinkSummary[]> {
    const links = await this.repository.findCurriculumLinks(examTypeId);
    const summaries: ExamTypeCurriculumLinkSummary[] = [];
    for (const link of links) {
      const curriculum = await this.curricula.findById(link.curriculumId);
      if (!curriculum) continue;
      summaries.push({
        curriculumId: link.curriculumId,
        curriculumName: curriculum.name,
        contextWeight: link.contextWeight,
        applicableModules: link.applicableModulesJson,
      });
    }
    return summaries;
  }

  /**
   * FR-AUTH-5's deletion flow.
   *
   * @throws {ExamTypeNotFoundError} if no such Exam Type exists.
   * @throws {ExamTypeHasActiveAttemptsError} if {@link ExamAuthoringRepository.hasActiveAttempts}
   *   reports an in-progress attempt against this Exam Type — always `false` this phase (see that
   *   method's own doc comment: no `attempts` module exists until Phase 7).
   */
  async delete(id: string): Promise<void> {
    const examType = await this.requireExamType(id);

    if (await this.repository.hasActiveAttempts(id)) {
      throw new ExamTypeHasActiveAttemptsError();
    }

    // DB delete first, storage second: `exam_type`'s cascade delete is transactional (a single
    // statement), so if it fails, storage is untouched; if it succeeds but the storage cleanup below
    // fails, an orphaned storage prefix is a strictly less severe failure mode than a dangling DB row
    // pointing at deleted storage (FR-AUTH-5 requires cleanup, but never requires the delete itself to
    // be blocked by a storage error).
    await this.repository.delete(id);
    if (examType.storagePath) {
      await this.storage.deletePrefix(examType.storagePath);
    }
  }

  /**
   * FR-AUTH-6 (migration plan Phase 6, sub-slice "6b" — **Phase 4's own deferral, now closed**): "An
   * exam manager can trigger a re-classification pass over an already-authored Exam Type's questions to
   * correct their subject mapping without re-uploading source material; already-correctly-mapped
   * questions are left untouched so the operation is cheap, idempotent, and safely repeatable."
   *
   * Delegates entirely to `server/pdf-processing`'s `SubjectClassificationService` — the SAME service
   * (and the same private `classify` core) the PDF pipeline's automatic FR-PDF-7 pass uses, which is
   * what makes the two paths' "never touch an already-mapped row" guarantee literally one
   * implementation rather than two agreeing ones. This method's own job is only the existence check
   * plus resolving the acting user for the AI invocation's audit context.
   *
   * Phase 4 deferred this whole method because `AiServicePort` did not exist yet; it does now (Phase 5),
   * and `SubjectClassificationService` does too (this sub-slice), so it is wired for real rather than
   * stubbed. `SubjectClassificationService` is consumed through `server/pdf-processing`'s public barrel,
   * never a deep import.
   *
   * @throws {ExamTypeNotFoundError} if no such Exam Type exists.
   * @returns `{examined, mapped}` — see `SubjectClassificationService.classifyUnmappedForExamType`'s own
   *   doc comment for exactly what each number means. `examined === 0` is the ordinary idempotent-no-op
   *   outcome of a second run.
   */
  async fixSubjectMapping(actingUserId: string | undefined, id: string): Promise<SubjectClassificationResult> {
    await this.requireExamType(id);
    return this.subjectClassification.classifyUnmappedForExamType(id, actingUserId);
  }

  private async requireExamType(id: string): Promise<ExamTypeEntity> {
    const examType = await this.repository.findById(id);
    if (!examType) throw new ExamTypeNotFoundError();
    return examType;
  }
}

/** FR-AUTH-1: "the declared total question count should reconcile with the sum of per-module counts; a
 * mismatch is flagged rather than silently accepted." Also rejects an empty `modules[]` with the same
 * `INVALID_ZIP_STRUCTURE` code `parseExamZip` uses for "no module folders" — both are the same
 * underlying condition ("this request declares no modules") from two different input surfaces (the
 * request body vs. the archive), so sharing the code keeps the client-facing contract simple. */
function validateModuleCounts(input: CreateExamTypeFromZipInput): void {
  if (input.modules.length === 0) {
    throw new InvalidZipStructureError('At least one module must be declared.');
  }
  const sum = input.modules.reduce((acc, m) => acc + m.questionCount, 0);
  if (sum !== input.totalQuestions) {
    throw new QuestionCountMismatchError(input.totalQuestions, sum);
  }
}

/** Cross-checks the ZIP's actual top-level folders against the request's declared `modules[]` names. A
 * mismatch in either direction (an extra folder the request didn't declare, or a declared module with
 * no matching folder) is `INVALID_ZIP_STRUCTURE`, since either case means the archive does not actually
 * implement the module configuration the manager described. */
function assertFoldersMatchDeclaredModules(input: CreateExamTypeFromZipInput, parsed: ParsedExamZip): void {
  const declared = new Set(input.modules.map((m) => m.name));
  const actual = new Set(parsed.modules.map((m) => m.moduleName));

  for (const name of actual) {
    if (!declared.has(name)) {
      throw new InvalidZipStructureError(
        `The ZIP archive contains a module folder "${name}" that was not declared in the request.`,
      );
    }
  }
  for (const name of declared) {
    if (!actual.has(name)) {
      throw new InvalidZipStructureError(`No folder found in the ZIP archive for declared module "${name}".`);
    }
  }
}

/** Cross-checks each declared module's `questionCount` against the ZIP's *actually parsed* question
 * count for that same module (by this point, `assertFoldersMatchDeclaredModules` has already guaranteed
 * every declared module has a matching folder in `parsed.modules`, so a direct lookup by name is safe).
 * This is what makes it impossible to persist an `ExamModule` whose stored `question_count` disagrees
 * with the real number of `ExamTypeQuestion` rows written for it — `buildInsert` below additionally
 * derives the persisted `questionCount` from `parsed`, not from `input`, so even if this check were ever
 * bypassed the stored value still reflects reality rather than the client's claim. */
function assertActualMatchesDeclaredModuleCounts(input: CreateExamTypeFromZipInput, parsed: ParsedExamZip): void {
  const actualByName = new Map(parsed.modules.map((m) => [m.moduleName, m.questions.length]));
  for (const declaredModule of input.modules) {
    const actualCount = actualByName.get(declaredModule.name);
    // Unreachable in practice (assertFoldersMatchDeclaredModules already proved every declared module
    // has a matching parsed folder), but guarded defensively rather than asserted with `!`.
    if (actualCount === undefined || actualCount !== declaredModule.questionCount) {
      throw QuestionCountMismatchError.forModule(declaredModule.name, declaredModule.questionCount, actualCount ?? 0);
    }
  }
}

/** Assembles the full set of rows one successful upload persists, and the storage keys those rows'
 * questions were (or are about to be) written under. Pure/side-effect-free — safe to call before any
 * storage/DB write has happened. */
function buildInsert(
  examTypeId: string,
  actingUserId: string | null,
  input: CreateExamTypeFromZipInput,
  parsed: ParsedExamZip,
  storagePrefix: string,
): ExamTypeInsert {
  const examType = new ExamTypeEntity();
  examType.id = examTypeId;
  examType.name = input.name;
  examType.description = input.description ?? null;
  examType.totalQuestions = input.totalQuestions;
  examType.totalMinutes = input.totalMinutes;
  examType.storagePath = storagePrefix;
  examType.stageId = input.stageId;
  examType.storageMode = 'LocalDisk';
  examType.kind = 'Standard';
  examType.origin = 'ZipImport';
  examType.createdByUserId = actingUserId;
  examType.pendingDeleteAt = null;

  // The persisted `questionCount` is derived from the ZIP's actual parsed question count for each
  // module, never from the client's declared `m.questionCount` — by this point
  // `assertActualMatchesDeclaredModuleCounts` has already proven the two agree, but deriving from
  // `parsed` (the authoritative source) rather than `input` (the client's claim) makes the "stored
  // question_count always matches real persisted rows" guarantee structural rather than dependent on
  // that check never being bypassed or a future call site being added upstream of it.
  const actualCountByName = new Map(parsed.modules.map((pm) => [pm.moduleName, pm.questions.length]));
  const modules = input.modules.map((m) => {
    const moduleEntity = new ExamModuleEntity();
    moduleEntity.id = randomUUID();
    moduleEntity.examTypeId = examTypeId;
    moduleEntity.moduleName = m.name;
    moduleEntity.questionCount = actualCountByName.get(m.name) ?? m.questionCount;
    return moduleEntity;
  });

  const questions = parsed.modules.flatMap((examModule) =>
    examModule.questions.map((question) => {
      const row = new ExamTypeQuestionEntity();
      row.id = randomUUID();
      row.examTypeId = examTypeId;
      row.moduleName = examModule.moduleName;
      row.questionKey = deriveQuestionKey(examModule.moduleName, question.sourceFileName);
      row.questionText = question.text;
      row.optionsJson = question.options;
      row.correctAnswer = question.correctAnswer;
      row.explanation = question.explanation;
      row.sourceGeneratedQuestionId = null;
      return row;
    }),
  );

  return { examType, modules, questions };
}

/** `question_key`'s ZIP-import derivation: `moduleName/fileNameWithoutExtension`, truncated to the
 * column's 200-character limit. Unique per Exam Type by construction — a ZIP cannot contain two files
 * with the same name in the same folder. */
function deriveQuestionKey(moduleName: string, fileName: string): string {
  const withoutExt = fileName.replace(/\.json$/i, '');
  return `${moduleName}/${withoutExt}`.slice(0, 200);
}

function toSummary(examType: ExamTypeEntity, modules: ExamModuleEntity[], curriculumLinks: ExamTypeCurriculumLinkSummary[]): ExamTypeSummary {
  return {
    id: examType.id,
    name: examType.name,
    description: examType.description,
    totalQuestions: examType.totalQuestions,
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

/** Thin wrapper translating `requireTenantId()`'s own `InternalDomainError` message into this method's
 * specific caller name, matching `ProfileService.uploadPicture`'s identical defensive-assertion framing
 * (this route only ever runs behind `withTenantContext`, so a missing tenant id here is a programmer
 * error). */
function requireTenantIdOrInternal(): string {
  try {
    return requireTenantId();
  } catch {
    throw new InternalDomainError(new Error('ExamAuthoringService.createFromZip() called outside any resolved tenant scope.'));
  }
}
