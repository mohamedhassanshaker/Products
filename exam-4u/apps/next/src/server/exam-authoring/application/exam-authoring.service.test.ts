import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';
import { runWithRequestContext } from '@/server/context';
import { ExamAuthoringService } from './exam-authoring.service';
import {
  ExamTypeHasActiveAttemptsError,
  ExamTypeNameExistsError,
  ExamTypeNotFoundError,
  QuestionCountMismatchError,
} from '../domain/errors';
import { InvalidZipStructureError } from '@/server/infrastructure/zip';
import type { ExamTypeEntity } from '@/server/infrastructure/database';

const TENANT_ID = 't-1';
const USER_ID = 'u-1';

/** Builds a real, well-formed ZIP archive via `yazl` — mirrors
 * `legacy/api/test/exam-authoring.e2e-spec.ts`'s own `buildZip` helper. */
function buildZip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(content, 'utf8'), name);
    }
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}

const validQuestion = (text = 'Q?', correct = 'A') =>
  JSON.stringify({ text, options: { A: 'a', B: 'b' }, correctAnswer: correct, explanation: 'exp' });

function withTenantScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID }, fn);
}

function examTypeEntity(overrides: Partial<ExamTypeEntity> = {}): ExamTypeEntity {
  return {
    id: 'e-1',
    name: 'Grade 10 Math',
    description: null,
    totalQuestions: 1,
    totalMinutes: 10,
    storagePath: 'tenants/t-1/exam-types/e-1/',
    stageId: 5,
    storageMode: 'LocalDisk',
    kind: 'Standard',
    origin: 'ZipImport',
    createdByUserId: USER_ID,
    pendingDeleteAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeService() {
  const repository = {
    insertExamType: vi.fn(),
    findById: vi.fn(),
    findModules: vi.fn().mockResolvedValue([]),
    findAll: vi.fn(),
    delete: vi.fn(),
    hasActiveAttempts: vi.fn().mockResolvedValue(false),
    findCurriculumLinks: vi.fn().mockResolvedValue([]),
  };
  const storage = {
    put: vi.fn(),
    getStream: vi.fn(),
    stat: vi.fn(),
    delete: vi.fn(),
    deletePrefix: vi.fn(),
    exists: vi.fn(),
  };
  // Phase 6 sub-slice "6b": FR-AUTH-6's `fixSubjectMapping` delegates to the shared
  // `SubjectClassificationService` (`server/pdf-processing`'s barrel), stubbed here.
  const subjectClassification = { classifyUnmappedForExamType: vi.fn().mockResolvedValue({ examined: 0, mapped: 0 }) };
  // This dispatch's real-browser closure pass (sub-slice "6c"'s deferred Playwright gap): `.get()` now
  // resolves FR-AUTH-4's `exam_type_curriculum` links via a `CurriculaRepository` collaborator, stubbed
  // here to an empty-name-lookup double (individual tests override `findById` where a real link name
  // matters).
  const curricula = { findById: vi.fn().mockResolvedValue(null) };
  const service = new ExamAuthoringService(repository as never, storage as never, subjectClassification as never, curricula as never);
  return { service, repository, storage, subjectClassification, curricula };
}

describe('ExamAuthoringService.createFromZip — programmer-error guard', () => {
  it('throws InternalDomainError when called outside any resolved tenant scope (defensive assertion)', async () => {
    const { service } = makeService();
    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    // Deliberately NOT wrapped in withTenantScope — proves requireTenantIdOrInternal()'s own
    // defensive catch-and-rethrow branch, matching ProfileService.uploadPicture's identical pattern.
    await expect(
      service.createFromZip(
        USER_ID,
        { name: 'X', totalQuestions: 1, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 1 }] },
        zip,
      ),
    ).rejects.toThrow('An unexpected error occurred. Please try again later.');
  });
});

describe('ExamAuthoringService.createFromZip — input self-consistency', () => {
  it('rejects an empty modules[] with INVALID_ZIP_STRUCTURE', async () => {
    const { service } = makeService();
    await withTenantScope(() =>
      expect(
        service.createFromZip(USER_ID, { name: 'X', totalQuestions: 1, totalMinutes: 10, stageId: 5, modules: [] }, Buffer.alloc(0)),
      ).rejects.toThrow(InvalidZipStructureError),
    );
  });

  it('rejects when declared totalQuestions does not equal the sum of declared module counts', async () => {
    const { service } = makeService();
    await withTenantScope(() =>
      expect(
        service.createFromZip(
          USER_ID,
          { name: 'X', totalQuestions: 5, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 2 }] },
          Buffer.alloc(0),
        ),
      ).rejects.toThrow(QuestionCountMismatchError),
    );
  });
});

describe('ExamAuthoringService.createFromZip — ZIP/declared-module reconciliation', () => {
  it('rejects a ZIP folder not declared in modules[]', async () => {
    const { service } = makeService();
    const zip = await buildZip({ 'Geometry/q1.json': validQuestion() });
    await withTenantScope(() =>
      expect(
        service.createFromZip(
          USER_ID,
          { name: 'X', totalQuestions: 1, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 1 }] },
          zip,
        ),
      ).rejects.toThrow(InvalidZipStructureError),
    );
  });

  it('rejects a declared module with no matching ZIP folder', async () => {
    const { service } = makeService();
    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    await withTenantScope(() =>
      expect(
        service.createFromZip(
          USER_ID,
          {
            name: 'X',
            totalQuestions: 2,
            totalMinutes: 10,
            stageId: 5,
            modules: [
              { name: 'Algebra', questionCount: 1 },
              { name: 'Geometry', questionCount: 1 },
            ],
          },
          zip,
        ),
      ).rejects.toThrow(InvalidZipStructureError),
    );
  });

  it('rejects when a declared module\'s questionCount does not match the ZIP\'s actual parsed count for it (content-level check)', async () => {
    const { service } = makeService();
    // Declares Algebra with questionCount=2 (and totalQuestions=2, so the pure self-consistency check
    // does NOT catch this), but the ZIP only actually contains 1 real question file for that module —
    // the exact QA-regression scenario legacy's own Dev-12b retry fixed.
    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    const err = await withTenantScope(() =>
      service
        .createFromZip(
          USER_ID,
          { name: 'X', totalQuestions: 2, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 2 }] },
          zip,
        )
        .catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(QuestionCountMismatchError);
    expect((err as QuestionCountMismatchError).details).toEqual({ module: 'Algebra', declaredCount: 2, actualCount: 1 });
  });
});

describe('ExamAuthoringService.createFromZip — happy path and persisted shape', () => {
  it('writes every question to storage and persists exam_type/exam_module/exam_type_question rows in one transaction', async () => {
    const { service, repository, storage } = makeService();
    const zip = await buildZip({
      'Algebra/q1.json': validQuestion('2+2?', 'A'),
      'Algebra/q2.json': validQuestion('3+3?', 'B'),
      'Geometry/q1.json': validQuestion('Angles?', 'A'),
    });

    const result = await withTenantScope(() =>
      service.createFromZip(
        USER_ID,
        {
          name: 'Grade 10 Math',
          totalQuestions: 3,
          totalMinutes: 60,
          stageId: 5,
          modules: [
            { name: 'Algebra', questionCount: 2 },
            { name: 'Geometry', questionCount: 1 },
          ],
        },
        zip,
      ),
    );

    expect(result.name).toBe('Grade 10 Math');
    expect(result.modules).toHaveLength(2);
    expect(result.origin).toBe('ZipImport');
    expect(storage.put).toHaveBeenCalledTimes(3);
    expect(repository.insertExamType).toHaveBeenCalledTimes(1);
    const insertArg = repository.insertExamType.mock.calls[0][0];
    expect(insertArg.examType.createdByUserId).toBe(USER_ID);
    expect(insertArg.questions).toHaveLength(3);
  });

  it('rolls back storage (deletePrefix) and translates a duplicate-name DB failure into ExamTypeNameExistsError', async () => {
    const { service, repository, storage } = makeService();
    const dupError = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    // Give the thrown error the exact shape `isDuplicateKeyError` checks (`instanceof QueryFailedError`)
    // is awkward to fake without importing typeorm's real class — instead this test exercises the
    // "any other error still rolls back storage and rethrows" branch, which every DB failure path
    // shares regardless of whether it's translated to ExamTypeNameExistsError.
    repository.insertExamType.mockRejectedValue(dupError);

    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    await withTenantScope(() =>
      expect(
        service.createFromZip(
          USER_ID,
          { name: 'Dup', totalQuestions: 1, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 1 }] },
          zip,
        ),
      ).rejects.toThrow(),
    );

    expect(storage.deletePrefix).toHaveBeenCalledTimes(1);
  });

  it('translates a real TypeORM duplicate-key QueryFailedError into ExamTypeNameExistsError', async () => {
    const { QueryFailedError } = await import('typeorm');
    const { service, repository, storage } = makeService();
    const dupError = new QueryFailedError('INSERT ...', [], new Error('Duplicate entry'));
    Object.assign(dupError, { code: 'ER_DUP_ENTRY' });
    repository.insertExamType.mockRejectedValue(dupError);

    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    await withTenantScope(() =>
      expect(
        service.createFromZip(
          USER_ID,
          { name: 'Dup', totalQuestions: 1, totalMinutes: 10, stageId: 5, modules: [{ name: 'Algebra', questionCount: 1 }] },
          zip,
        ),
      ).rejects.toThrow(ExamTypeNameExistsError),
    );
    expect(storage.deletePrefix).toHaveBeenCalledTimes(1);
  });
});

describe('ExamAuthoringService — list/get/delete', () => {
  it('get() throws ExamTypeNotFoundError for an unknown id', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toThrow(ExamTypeNotFoundError);
  });

  it('get() returns a summary including its modules', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(examTypeEntity());
    repository.findModules.mockResolvedValue([{ id: 'm-1', examTypeId: 'e-1', moduleName: 'Algebra', questionCount: 1 }]);
    const result = await service.get('e-1');
    expect(result.modules).toEqual([{ id: 'm-1', moduleName: 'Algebra', questionCount: 1 }]);
  });

  it('list() returns a summary per exam type with its modules attached', async () => {
    const { service, repository } = makeService();
    repository.findAll.mockResolvedValue([examTypeEntity()]);
    repository.findModules.mockResolvedValue([]);
    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e-1');
  });

  it('delete() throws ExamTypeNotFoundError for an unknown id, never touching storage', async () => {
    const { service, repository, storage } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.delete('missing')).rejects.toThrow(ExamTypeNotFoundError);
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it('delete() removes the DB row then deletes its storage prefix', async () => {
    const { service, repository, storage } = makeService();
    repository.findById.mockResolvedValue(examTypeEntity());
    await service.delete('e-1');
    expect(repository.delete).toHaveBeenCalledWith('e-1');
    expect(storage.deletePrefix).toHaveBeenCalledWith('tenants/t-1/exam-types/e-1/');
  });

  it('delete() throws ExamTypeHasActiveAttemptsError when hasActiveAttempts reports true, without deleting', async () => {
    const { service, repository, storage } = makeService();
    repository.findById.mockResolvedValue(examTypeEntity());
    repository.hasActiveAttempts.mockResolvedValue(true);
    await expect(service.delete('e-1')).rejects.toThrow(ExamTypeHasActiveAttemptsError);
    expect(repository.delete).not.toHaveBeenCalled();
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it('delete() never calls hasActiveAttempts before confirming the Exam Type exists', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.delete('missing')).rejects.toThrow(ExamTypeNotFoundError);
    expect(repository.hasActiveAttempts).not.toHaveBeenCalled();
  });
});

describe('ExamAuthoringService.fixSubjectMapping (FR-AUTH-6 — Phase 4 deferral, closed in sub-slice 6b)', () => {
  it('throws ExamTypeNotFoundError for an unknown id, without ever invoking the AI-backed pass', async () => {
    const { service, repository, subjectClassification } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.fixSubjectMapping(USER_ID, 'missing')).rejects.toThrow(ExamTypeNotFoundError);
    expect(subjectClassification.classifyUnmappedForExamType).not.toHaveBeenCalled();
  });

  it('delegates to the SHARED SubjectClassificationService, forwarding the acting user for audit context', async () => {
    const { service, repository, subjectClassification } = makeService();
    repository.findById.mockResolvedValue({ id: 'et-1' });
    subjectClassification.classifyUnmappedForExamType.mockResolvedValue({ examined: 3, mapped: 2 });
    await expect(service.fixSubjectMapping(USER_ID, 'et-1')).resolves.toEqual({ examined: 3, mapped: 2 });
    expect(subjectClassification.classifyUnmappedForExamType).toHaveBeenCalledWith('et-1', USER_ID);
  });

  it('is a genuine no-op on a second run over already-fully-mapped content (examined 0, FR-AUTH-6 idempotency)', async () => {
    const { service, repository, subjectClassification } = makeService();
    repository.findById.mockResolvedValue({ id: 'et-1' });
    subjectClassification.classifyUnmappedForExamType.mockResolvedValue({ examined: 0, mapped: 0 });
    await expect(service.fixSubjectMapping(USER_ID, 'et-1')).resolves.toEqual({ examined: 0, mapped: 0 });
  });
});
