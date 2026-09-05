import { describe, expect, it, vi } from 'vitest';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { FeatureInUseError, FeatureKeyExistsError, FeatureKeyImmutableError, FeatureNotFoundError } from '../domain/errors';
import type { FeatureRepository } from '../infrastructure/feature.repository';
import { FeaturesService } from './features.service';

/** Pure-logic unit tests (fake repository, no real database) for `FeaturesService`'s validation rules
 * and fail-closed invariants — migration plan Phase 2 sub-slice "2b"'s own "Per-phase verification"
 * item 4. */

function createFakeRepo(overrides: Partial<FeatureRepository> = {}): FeatureRepository {
  const base: Partial<FeatureRepository> = {
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findByIds: vi.fn(async () => []),
    existsByKey: vi.fn(async () => false),
    countPackageReferences: vi.fn(async () => 0),
    countPackageReferencesByFeatureIds: vi.fn(async () => new Map()),
    create: vi.fn(async (input) => ({ id: 'f1', ...input, createdAt: new Date() }) as never),
    save: vi.fn(async (entity) => entity as never),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as FeatureRepository;
}

const baseRow = {
  id: 'f1',
  key: 'exams.create',
  name: 'Create exams',
  description: null,
  unit: 'exams',
  resetPeriod: 'MONTHLY' as const,
  createdAt: new Date(),
};

describe('FeaturesService.create', () => {
  it('rejects a malformed key', async () => {
    const service = new FeaturesService(createFakeRepo());
    await expect(
      service.create({ key: 'Bad Key!', name: 'x', unit: 'y', resetPeriod: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('rejects an already-taken key', async () => {
    const repo = createFakeRepo({ existsByKey: vi.fn(async () => true) });
    const service = new FeaturesService(repo);
    await expect(
      service.create({ key: 'exams.create', name: 'x', unit: 'y', resetPeriod: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(FeatureKeyExistsError);
  });

  it('creates a feature, always reporting isReferenced: false for a brand-new row', async () => {
    const repo = createFakeRepo();
    const service = new FeaturesService(repo);
    const result = await service.create({ key: 'exams.create', name: 'Create exams', unit: 'exams', resetPeriod: 'MONTHLY' });
    expect(result.isReferenced).toBe(false);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'exams.create' }));
  });
});

describe('FeaturesService.get/list', () => {
  it('get() throws FeatureNotFoundError for an unknown id', async () => {
    const service = new FeaturesService(createFakeRepo());
    await expect(service.get('missing')).rejects.toBeInstanceOf(FeatureNotFoundError);
  });

  it('get() reports isReferenced: true when at least one package references it', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })), countPackageReferences: vi.fn(async () => 2) });
    const service = new FeaturesService(repo);
    const result = await service.get('f1');
    expect(result.isReferenced).toBe(true);
  });

  it('list() annotates each row via one grouped reference-count query', async () => {
    const repo = createFakeRepo({
      findAll: vi.fn(async () => [{ ...baseRow }, { ...baseRow, id: 'f2', key: 'exams.total' }]),
      countPackageReferencesByFeatureIds: vi.fn(async () => new Map([['f2', 3]])),
    });
    const service = new FeaturesService(repo);
    const result = await service.list();
    expect(result.find((r) => r.id === 'f1')?.isReferenced).toBe(false);
    expect(result.find((r) => r.id === 'f2')?.isReferenced).toBe(true);
  });
});

describe('FeaturesService.update', () => {
  it('throws FeatureNotFoundError for an unknown id', async () => {
    const service = new FeaturesService(createFakeRepo());
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(FeatureNotFoundError);
  });

  it('rejects a malformed new key', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const service = new FeaturesService(repo);
    await expect(service.update('f1', { key: 'BAD KEY' })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('rejects a key change on a referenced feature (FEATURE_KEY_IMMUTABLE)', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })), countPackageReferences: vi.fn(async () => 1) });
    const service = new FeaturesService(repo);
    await expect(service.update('f1', { key: 'exams.other' })).rejects.toBeInstanceOf(FeatureKeyImmutableError);
  });

  it('allows a key change on an unreferenced feature, rejecting a collision with a different feature', async () => {
    const repo = createFakeRepo({
      findById: vi.fn(async () => ({ ...baseRow })),
      countPackageReferences: vi.fn(async () => 0),
      existsByKey: vi.fn(async () => true),
    });
    const service = new FeaturesService(repo);
    await expect(service.update('f1', { key: 'exams.other' })).rejects.toBeInstanceOf(FeatureKeyExistsError);
  });

  it('leaves an unsupplied field unchanged', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const service = new FeaturesService(repo);
    const result = await service.update('f1', { name: 'Renamed' });
    expect(result.name).toBe('Renamed');
    expect(result.unit).toBe('exams');
  });
});

describe('FeaturesService.delete', () => {
  it('throws FeatureNotFoundError for an unknown id', async () => {
    const service = new FeaturesService(createFakeRepo());
    await expect(service.delete('missing')).rejects.toBeInstanceOf(FeatureNotFoundError);
  });

  it('throws FeatureInUseError when still referenced by a package', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })), countPackageReferences: vi.fn(async () => 1) });
    const service = new FeaturesService(repo);
    await expect(service.delete('f1')).rejects.toBeInstanceOf(FeatureInUseError);
  });

  it('deletes an unreferenced feature', async () => {
    const repo = createFakeRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const service = new FeaturesService(repo);
    await service.delete('f1');
    expect(repo.delete).toHaveBeenCalledWith('f1');
  });
});
