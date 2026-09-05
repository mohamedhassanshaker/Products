import { describe, expect, it, vi } from 'vitest';
import { CurriculaService } from './curricula.service';
import { CurriculumNotFoundError, NotCurriculumOwnerError, SubjectNotFoundError } from '../domain/errors';
import type { CurriculumEntity, SubjectEntity } from '@/server/infrastructure/database';

const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

function curriculum(overrides: Partial<CurriculumEntity> = {}): CurriculumEntity {
  return {
    id: 'c-1',
    name: 'Biology 101',
    description: null,
    subjectId: 5,
    ownerUserId: OWNER_ID,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function subject(overrides: Partial<SubjectEntity> = {}): SubjectEntity {
  return { id: 5, stageId: 1, name: 'Biology', createdAt: new Date('2026-01-01'), ...overrides };
}

/** Any tenant id — `CurriculaService` only forwards it to the chunk-cleanup call. */
const TENANT_ID = 't-1';

function makeService() {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const subjects = { findById: vi.fn(), findByStage: vi.fn(), findAll: vi.fn(), findByName: vi.fn(), create: vi.fn(), delete: vi.fn() };
  const permissions = { hasPermission: vi.fn(), getEffectivePermissions: vi.fn() };
  // Phase 6 sub-slice "6b": deleting a Curriculum now also purges its indexed Qdrant chunks.
  const indexing = { deleteChunksForCurriculum: vi.fn().mockResolvedValue(undefined) };
  const service = new CurriculaService(repository as never, subjects as never, permissions as never, indexing as never);
  return { service, repository, subjects, permissions, indexing };
}

describe('CurriculaService — create', () => {
  it('throws SubjectNotFoundError when subjectId does not exist in this tenant', async () => {
    const { service, subjects } = makeService();
    subjects.findById.mockResolvedValue(null);
    await expect(service.create(OWNER_ID, { name: 'Biology 101', subjectId: 999 })).rejects.toThrow(SubjectNotFoundError);
  });

  it('creates a Curriculum owned by the acting user when the subject exists', async () => {
    const { service, subjects, repository } = makeService();
    subjects.findById.mockResolvedValue(subject());
    repository.create.mockImplementation(async (entity: CurriculumEntity) => entity);

    const result = await service.create(OWNER_ID, { name: 'Biology 101', description: 'intro', subjectId: 5 });

    expect(result.ownerUserId).toBe(OWNER_ID);
    expect(result.subjectId).toBe(5);
    expect(result.name).toBe('Biology 101');
    expect(result.description).toBe('intro');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: OWNER_ID, subjectId: 5 }));
  });

  it('defaults description to null when omitted', async () => {
    const { service, subjects, repository } = makeService();
    subjects.findById.mockResolvedValue(subject());
    repository.create.mockImplementation(async (entity: CurriculumEntity) => entity);
    const result = await service.create(OWNER_ID, { name: 'Biology 101', subjectId: 5 });
    expect(result.description).toBeNull();
  });
});

describe('CurriculaService — list (own vs. oversight)', () => {
  it('lists only the acting user\'s own curricula when they lack curricula.read_all', async () => {
    const { service, repository, permissions } = makeService();
    permissions.hasPermission.mockResolvedValue(false);
    repository.findAll.mockResolvedValue([curriculum()]);
    await service.list(OWNER_ID);
    expect(repository.findAll).toHaveBeenCalledWith(OWNER_ID);
  });

  it('lists every curriculum in the tenant when the acting user holds curricula.read_all', async () => {
    const { service, repository, permissions } = makeService();
    permissions.hasPermission.mockResolvedValue(true);
    repository.findAll.mockResolvedValue([curriculum()]);
    await service.list(OTHER_USER_ID);
    expect(repository.findAll).toHaveBeenCalledWith(undefined);
  });
});

describe('CurriculaService — get/update/delete ownership enforcement', () => {
  it('get() throws CurriculumNotFoundError for an unknown id', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.get(OWNER_ID, 'missing')).rejects.toThrow(CurriculumNotFoundError);
  });

  it('get() throws NotCurriculumOwnerError (403, not 404) for a non-owner without oversight', async () => {
    const { service, repository, permissions } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    permissions.hasPermission.mockResolvedValue(false);
    await expect(service.get(OTHER_USER_ID, 'c-1')).rejects.toThrow(NotCurriculumOwnerError);
  });

  it('get() succeeds for a non-owner who holds curricula.read_all (Tenant Admin oversight)', async () => {
    const { service, repository, permissions } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    permissions.hasPermission.mockResolvedValue(true);
    const result = await service.get(OTHER_USER_ID, 'c-1');
    expect(result.id).toBe('c-1');
  });

  it('get() succeeds for the actual owner without ever checking the oversight permission', async () => {
    const { service, repository, permissions } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    const result = await service.get(OWNER_ID, 'c-1');
    expect(result.id).toBe('c-1');
    expect(permissions.hasPermission).not.toHaveBeenCalled();
  });

  it('update() applies only the provided fields and re-reads the fresh row', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValueOnce(curriculum()).mockResolvedValueOnce(curriculum({ name: 'Biology 102' }));
    const result = await service.update(OWNER_ID, 'c-1', { name: 'Biology 102' });
    expect(repository.update).toHaveBeenCalledWith('c-1', { name: 'Biology 102' });
    expect(result.name).toBe('Biology 102');
  });

  it('update() is a no-op write when the patch is empty (still re-reads)', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    await service.update(OWNER_ID, 'c-1', {});
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('update() rejects a non-owner without oversight', async () => {
    const { service, repository, permissions } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    permissions.hasPermission.mockResolvedValue(false);
    await expect(service.update(OTHER_USER_ID, 'c-1', { name: 'x' })).rejects.toThrow(NotCurriculumOwnerError);
  });

  it('delete() removes the row for the owner', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    await service.delete(OWNER_ID, TENANT_ID, 'c-1');
    expect(repository.delete).toHaveBeenCalledWith('c-1');
  });

  it('delete() rejects a non-owner without oversight, never deleting', async () => {
    const { service, repository, permissions } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    permissions.hasPermission.mockResolvedValue(false);
    await expect(service.delete(OTHER_USER_ID, TENANT_ID, 'c-1')).rejects.toThrow(NotCurriculumOwnerError);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('delete() purges the indexed chunks BEFORE deleting the row (no orphaned vectors)', async () => {
    const { service, repository, indexing } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    await service.delete(OWNER_ID, TENANT_ID, 'c-1');
    expect(indexing.deleteChunksForCurriculum).toHaveBeenCalledWith(TENANT_ID, 'c-1');
    expect(indexing.deleteChunksForCurriculum.mock.invocationCallOrder[0]).toBeLessThan(repository.delete.mock.invocationCallOrder[0]);
  });

  it('delete() still deletes the row when chunk cleanup fails (best-effort, never blocks the user)', async () => {
    const { service, repository, indexing } = makeService();
    repository.findById.mockResolvedValue(curriculum());
    indexing.deleteChunksForCurriculum.mockRejectedValue(new Error('qdrant down'));
    await expect(service.delete(OWNER_ID, TENANT_ID, 'c-1')).resolves.toBeUndefined();
    expect(repository.delete).toHaveBeenCalledWith('c-1');
  });

  it('delete() throws CurriculumNotFoundError for an unknown id', async () => {
    const { service, repository } = makeService();
    repository.findById.mockResolvedValue(null);
    await expect(service.delete(OWNER_ID, TENANT_ID, 'missing')).rejects.toThrow(CurriculumNotFoundError);
  });
});
