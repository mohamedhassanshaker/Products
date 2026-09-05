import { describe, expect, it, vi } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { TaxonomyService } from './taxonomy.service';
import { InvalidNameError, TaxonomyEntryInUseError, TaxonomyEntryNotFoundError } from '../domain/errors';
import type { EducationLevelEntity, StageEntity, SubjectEntity } from '@/server/infrastructure/database';

/** A `QueryFailedError`-shaped fake carrying the given MySQL driver `code`, matching how
 * `mysql-error.util.ts`'s type guards actually narrow (`instanceof QueryFailedError && .code === ...`). */
function driverError(code: string): QueryFailedError {
  const err = new QueryFailedError('', [], new Error('driver error'));
  (err as unknown as { code: string }).code = code;
  return err;
}

function educationLevel(overrides: Partial<EducationLevelEntity> = {}): EducationLevelEntity {
  return { id: 1, name: 'Secondary', createdAt: new Date('2026-01-01'), ...overrides };
}

function stage(overrides: Partial<StageEntity> = {}): StageEntity {
  return { id: 10, educationLevelId: 1, name: 'Grade 10', createdAt: new Date('2026-01-01'), ...overrides };
}

function subject(overrides: Partial<SubjectEntity> = {}): SubjectEntity {
  return { id: 100, stageId: 10, name: 'Biology', createdAt: new Date('2026-01-01'), ...overrides };
}

/** Minimal hand-built fakes matching each repository's shape — no real DB/TypeORM, per this project's
 * "unit tests use fakes for anything crossing a boundary" convention. */
function makeFakes() {
  const educationLevels = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    isReferencedByUser: vi.fn(),
    delete: vi.fn(),
  };
  const stages = {
    findByEducationLevel: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  const subjects = {
    findByStage: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
  return { educationLevels, stages, subjects };
}

function makeService() {
  const fakes = makeFakes();
  // Cast through unknown: these fakes intentionally implement only the methods TaxonomyService calls.
  const service = new TaxonomyService(fakes.educationLevels as never, fakes.stages as never, fakes.subjects as never);
  return { service, ...fakes };
}

describe('TaxonomyService — education levels', () => {
  it('lists education levels ordered as returned by the repository', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findAll.mockResolvedValue([educationLevel({ id: 1, name: 'Primary' }), educationLevel({ id: 2, name: 'Secondary' })]);
    const result = await service.listEducationLevels();
    expect(result).toEqual([
      { id: 1, name: 'Primary', createdAt: expect.any(Date) },
      { id: 2, name: 'Secondary', createdAt: expect.any(Date) },
    ]);
  });

  it('rejects a name shorter than 2 characters with InvalidNameError, never calling create', async () => {
    const { service, educationLevels } = makeService();
    await expect(service.createOrFetchEducationLevel(' a ')).rejects.toThrow(InvalidNameError);
    expect(educationLevels.create).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 150 characters with InvalidNameError', async () => {
    const { service } = makeService();
    await expect(service.createOrFetchEducationLevel('x'.repeat(151))).rejects.toThrow(InvalidNameError);
  });

  it('trims the name before creating and reports created=true on a fresh insert', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.create.mockResolvedValue(educationLevel({ name: 'Secondary' }));
    const result = await service.createOrFetchEducationLevel('  Secondary  ');
    expect(educationLevels.create).toHaveBeenCalledWith('Secondary');
    expect(result).toEqual({ entity: { id: 1, name: 'Secondary', createdAt: expect.any(Date) }, created: true });
  });

  it('falls back to a re-fetch on a duplicate-key race and reports created=false (FR-TAX-2 concurrency)', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.create.mockRejectedValue(driverError('ER_DUP_ENTRY'));
    educationLevels.findByName.mockResolvedValue(educationLevel({ name: 'Secondary' }));
    const result = await service.createOrFetchEducationLevel('Secondary');
    expect(result.created).toBe(false);
    expect(result.entity.name).toBe('Secondary');
  });

  it('re-throws a duplicate-key error if the fallback re-fetch still finds nothing (should be unreachable, defensive)', async () => {
    const { service, educationLevels } = makeService();
    const err = driverError('ER_DUP_ENTRY');
    educationLevels.create.mockRejectedValue(err);
    educationLevels.findByName.mockResolvedValue(null);
    await expect(service.createOrFetchEducationLevel('Secondary')).rejects.toBe(err);
  });

  it('re-throws a non-duplicate-key error from create() unchanged', async () => {
    const { service, educationLevels } = makeService();
    const err = new Error('connection reset');
    educationLevels.create.mockRejectedValue(err);
    await expect(service.createOrFetchEducationLevel('Secondary')).rejects.toBe(err);
  });

  it('deleteEducationLevel throws TaxonomyEntryNotFoundError for an unknown id', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(null);
    await expect(service.deleteEducationLevel(999)).rejects.toThrow(TaxonomyEntryNotFoundError);
    expect(educationLevels.delete).not.toHaveBeenCalled();
  });

  it('deleteEducationLevel throws TaxonomyEntryInUseError when referenced by a user (FR-TAX-4 part 1)', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(educationLevel());
    educationLevels.isReferencedByUser.mockResolvedValue(true);
    await expect(service.deleteEducationLevel(1)).rejects.toThrow(TaxonomyEntryInUseError);
    expect(educationLevels.delete).not.toHaveBeenCalled();
  });

  it('deleteEducationLevel translates a generic FK violation to TaxonomyEntryInUseError (FR-TAX-4 part 2)', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(educationLevel());
    educationLevels.isReferencedByUser.mockResolvedValue(false);
    educationLevels.delete.mockRejectedValue(driverError('ER_ROW_IS_REFERENCED_2'));
    await expect(service.deleteEducationLevel(1)).rejects.toThrow(TaxonomyEntryInUseError);
  });

  it('deleteEducationLevel succeeds when unreferenced', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(educationLevel());
    educationLevels.isReferencedByUser.mockResolvedValue(false);
    educationLevels.delete.mockResolvedValue(undefined);
    await expect(service.deleteEducationLevel(1)).resolves.toBeUndefined();
  });
});

describe('TaxonomyService — stages', () => {
  it('listStages throws TaxonomyEntryNotFoundError if the parent education level does not exist', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(null);
    await expect(service.listStages(1)).rejects.toThrow(TaxonomyEntryNotFoundError);
  });

  it('listStages returns the parent-scoped stages once the parent is confirmed to exist', async () => {
    const { service, educationLevels, stages } = makeService();
    educationLevels.findById.mockResolvedValue(educationLevel());
    stages.findByEducationLevel.mockResolvedValue([stage()]);
    const result = await service.listStages(1);
    expect(result).toEqual([{ id: 10, educationLevelId: 1, name: 'Grade 10', createdAt: expect.any(Date) }]);
  });

  it('createOrFetchStage validates the parent exists before validating the name', async () => {
    const { service, educationLevels } = makeService();
    educationLevels.findById.mockResolvedValue(null);
    await expect(service.createOrFetchStage(1, 'Grade 10')).rejects.toThrow(TaxonomyEntryNotFoundError);
  });

  it('createOrFetchStage falls back to a re-fetch scoped to (educationLevelId, name) on a race', async () => {
    const { service, educationLevels, stages } = makeService();
    educationLevels.findById.mockResolvedValue(educationLevel());
    stages.create.mockRejectedValue(driverError('ER_DUP_ENTRY'));
    stages.findByName.mockResolvedValue(stage());
    const result = await service.createOrFetchStage(1, 'Grade 10');
    expect(stages.findByName).toHaveBeenCalledWith(1, 'Grade 10');
    expect(result.created).toBe(false);
  });

  it('deleteStage translates a generic FK violation (referenced by a subject) to TaxonomyEntryInUseError', async () => {
    const { service, stages } = makeService();
    stages.findById.mockResolvedValue(stage());
    stages.delete.mockRejectedValue(driverError('ER_ROW_IS_REFERENCED_2'));
    await expect(service.deleteStage(10)).rejects.toThrow(TaxonomyEntryInUseError);
  });
});

describe('TaxonomyService — subjects', () => {
  it('listSubjects throws TaxonomyEntryNotFoundError if the parent stage does not exist', async () => {
    const { service, stages } = makeService();
    stages.findById.mockResolvedValue(null);
    await expect(service.listSubjects(10)).rejects.toThrow(TaxonomyEntryNotFoundError);
  });

  it('createOrFetchSubject rejects an invalid name even when the parent stage exists', async () => {
    const { service, stages } = makeService();
    stages.findById.mockResolvedValue(stage());
    await expect(service.createOrFetchSubject(10, '')).rejects.toThrow(InvalidNameError);
  });

  it('createOrFetchSubject creates a fresh subject and reports created=true', async () => {
    const { service, stages, subjects } = makeService();
    stages.findById.mockResolvedValue(stage());
    subjects.create.mockResolvedValue(subject());
    const result = await service.createOrFetchSubject(10, 'Biology');
    expect(result).toEqual({ entity: { id: 100, stageId: 10, name: 'Biology', createdAt: expect.any(Date) }, created: true });
  });

  it('deleteSubject throws TaxonomyEntryNotFoundError for an unknown id', async () => {
    const { service, subjects } = makeService();
    subjects.findById.mockResolvedValue(null);
    await expect(service.deleteSubject(999)).rejects.toThrow(TaxonomyEntryNotFoundError);
  });

  it('deleteSubject succeeds when unreferenced', async () => {
    const { service, subjects } = makeService();
    subjects.findById.mockResolvedValue(subject());
    subjects.delete.mockResolvedValue(undefined);
    await expect(service.deleteSubject(100)).resolves.toBeUndefined();
  });

  it('deleteSubject translates a generic FK violation (e.g. a referencing curriculum) to TaxonomyEntryInUseError', async () => {
    const { service, subjects } = makeService();
    subjects.findById.mockResolvedValue(subject());
    subjects.delete.mockRejectedValue(driverError('ER_ROW_IS_REFERENCED_2'));
    await expect(service.deleteSubject(100)).rejects.toThrow(TaxonomyEntryInUseError);
  });
});
