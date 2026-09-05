import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { ImageAssociationService } from './image-association.service';
import type { StoredImageRepository } from '../infrastructure/stored-image.repository';
import type { QuestionImageRepository } from '../infrastructure/question-image.repository';

/** A `DataSource` stub whose `transaction(fn)` simply runs the callback with a sentinel manager — the
 * transactional *semantics* are proven by the real-MySQL integration test; this exercises the
 * in-transaction call ordering/branching. */
const FAKE_MANAGER = { __manager: true };
function fakeDataSource(): DataSource {
  return { transaction: (fn: (m: unknown) => unknown) => fn(FAKE_MANAGER) } as unknown as DataSource;
}

function make(opts: {
  findByHash?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  findExisting?: ReturnType<typeof vi.fn>;
  deleteAndReturn?: ReturnType<typeof vi.fn>;
  decrementUsageCount?: ReturnType<typeof vi.fn>;
} = {}) {
  const storedImages = {
    findByHash: opts.findByHash ?? vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue({ id: 'img-1', storageKey: 'tenants/t-1/pdf/s-1/images/abc.png' }),
    findByIds: vi.fn().mockResolvedValue([]),
    insert: opts.insert ?? vi.fn().mockImplementation(async (e: unknown) => e),
    incrementUsageCount: vi.fn().mockResolvedValue(undefined),
    decrementUsageCount: opts.decrementUsageCount ?? vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(undefined),
    updateGeneratedAltText: vi.fn().mockResolvedValue(undefined),
  };
  const questionImages = {
    findExisting: opts.findExisting ?? vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockImplementation(async (e: unknown) => e),
    deleteAndReturn: opts.deleteAndReturn ?? vi.fn().mockResolvedValue({ id: 'qi-1', imageId: 'img-1' }),
    findForQuestions: vi.fn().mockResolvedValue([]),
  };
  const storage = { put: vi.fn().mockResolvedValue({ key: 'k', size: 1 }), delete: vi.fn().mockResolvedValue(undefined) };
  const service = new ImageAssociationService(
    fakeDataSource(),
    storage as unknown as StoragePort,
    storedImages as unknown as StoredImageRepository,
    questionImages as unknown as QuestionImageRepository,
  );
  return { service, storage, storedImages, questionImages };
}

const IMAGE = {
  data: Buffer.from('image-bytes'),
  contentType: 'image/png',
  extension: 'png',
  width: 100,
  height: 80,
  sourcePageNumber: 3,
  sourceDocumentId: null,
  originalFileName: null,
};

const ASSOCIATION = {
  generatedQuestionId: 'q-1',
  imageId: 'img-1',
  position: 'question_text' as const,
  optionKey: null,
  altText: 'Alt',
  caption: null,
  sequenceOrder: null,
  width: 100,
  height: 80,
};

describe('ImageAssociationService.storeOrReuseImage (FR-PDF-11 content-hash dedup)', () => {
  it('hashes and stores a genuinely new image, keying the storage object by content hash', async () => {
    const { service, storage } = make();
    const stored = await service.storeOrReuseImage('tenants/t-1/pdf/s-1/images/', IMAGE);

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(stored.fileHash).toHaveLength(64);
    expect(stored.fileName).toBe(`${stored.fileHash}.png`);
    expect(stored.usageCount).toBe(0); // merely stored, not yet associated
  });

  it('REUSES an existing row on a hash hit — no second storage write, no second row', async () => {
    const existing = { id: 'img-existing' };
    const { service, storage, storedImages } = make({ findByHash: vi.fn().mockResolvedValue(existing) });

    await expect(service.storeOrReuseImage('p/', IMAGE)).resolves.toBe(existing);
    expect(storage.put).not.toHaveBeenCalled();
    expect(storedImages.insert).not.toHaveBeenCalled();
  });

  it('recovers the winner’s row when a concurrent pass loses the uq_image_hash race', async () => {
    const winner = { id: 'img-winner' };
    const findByHash = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const insert = vi.fn().mockImplementation(async () => {
      throw new Error("Duplicate entry for key 'uq_image_hash'");
    });
    const { service } = make({ findByHash, insert });

    await expect(service.storeOrReuseImage('p/', IMAGE)).resolves.toBe(winner);
  });

  it('rethrows a genuine insert failure that is NOT a lost dedup race', async () => {
    const insert = vi.fn().mockImplementation(async () => {
      throw new Error('connection lost');
    });
    const { service } = make({ insert });
    await expect(service.storeOrReuseImage('p/', IMAGE)).rejects.toThrow('connection lost');
  });

  it('sanitizes a hostile extension so no separator/traversal can ever reach a storage key', async () => {
    const { service, storage } = make();
    await service.storeOrReuseImage('tenants/t-1/images/', { ...IMAGE, extension: '../../evil' });

    const key: string = storage.put.mock.calls[0][0];
    expect(key.startsWith('tenants/t-1/images/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain('/evil');
  });
});

describe('ImageAssociationService.associateWithQuestion (FR-FILE-3 reference counting)', () => {
  it('creates the association and increments usage_count exactly once', async () => {
    const { service, storedImages, questionImages } = make();
    await service.associateWithQuestion(ASSOCIATION);

    expect(questionImages.insert).toHaveBeenCalledTimes(1);
    expect(storedImages.incrementUsageCount).toHaveBeenCalledWith('img-1', FAKE_MANAGER);
  });

  it('is idempotent for the same (question,image,position,option) tuple — no double increment', async () => {
    const existing = { id: 'qi-existing' };
    const { service, storedImages, questionImages } = make({ findExisting: vi.fn().mockResolvedValue(existing) });

    await expect(service.associateWithQuestion(ASSOCIATION)).resolves.toBe(existing);
    expect(questionImages.insert).not.toHaveBeenCalled();
    expect(storedImages.incrementUsageCount).not.toHaveBeenCalled();
  });
});

describe('ImageAssociationService.removeAssociation (FR-FILE-3 reference counting)', () => {
  it('keeps a still-shared image alive when the count is still above zero after the decrement', async () => {
    const { service, storedImages } = make({ decrementUsageCount: vi.fn().mockResolvedValue(1) });
    await expect(service.removeAssociation('qi-1')).resolves.toEqual({ removed: true, imageDeleted: false, storageKeyToDelete: null });
    expect(storedImages.delete).not.toHaveBeenCalled();
  });

  it('deletes the image row only once the LAST reference is gone, reporting the orphaned storage key', async () => {
    const { service, storedImages } = make({ decrementUsageCount: vi.fn().mockResolvedValue(0) });
    await expect(service.removeAssociation('qi-1')).resolves.toEqual({
      removed: true,
      imageDeleted: true,
      storageKeyToDelete: 'tenants/t-1/pdf/s-1/images/abc.png',
    });
    expect(storedImages.delete).toHaveBeenCalledWith('img-1', FAKE_MANAGER);
  });

  it('is a clean no-op for an unknown association id', async () => {
    const { service, storedImages } = make({ deleteAndReturn: vi.fn().mockResolvedValue(null) });
    await expect(service.removeAssociation('nope')).resolves.toEqual({ removed: false, imageDeleted: false, storageKeyToDelete: null });
    expect(storedImages.decrementUsageCount).not.toHaveBeenCalled();
  });

  it('deletes the orphaned storage object only AFTER the transaction, and swallows a storage failure', async () => {
    const { service, storage } = make({ decrementUsageCount: vi.fn().mockResolvedValue(0) });
    storage.delete.mockImplementation(async () => {
      throw new Error('storage down');
    });
    await expect(service.removeAssociationAndCleanupStorage('qi-1')).resolves.toMatchObject({ imageDeleted: true });
    expect(storage.delete).toHaveBeenCalledWith('tenants/t-1/pdf/s-1/images/abc.png');
  });

  it('does not touch storage when nothing was orphaned', async () => {
    const { service, storage } = make({ decrementUsageCount: vi.fn().mockResolvedValue(2) });
    await service.removeAssociationAndCleanupStorage('qi-1');
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('ImageAssociationService.listImagesForQuestions', () => {
  it('returns an empty map for no ids, without querying', async () => {
    const { service, questionImages } = make();
    await expect(service.listImagesForQuestions([])).resolves.toEqual(new Map());
    expect(questionImages.findForQuestions).not.toHaveBeenCalled();
  });

  it('groups associations by question, resolving each one’s storage key via a single batched lookup', async () => {
    const { service, storedImages, questionImages } = make();
    questionImages.findForQuestions.mockResolvedValue([
      { id: 'qi-1', generatedQuestionId: 'q-1', imageId: 'img-1', altText: 'A', caption: null, position: 'question_text', optionKey: null, width: 1, height: 2 },
      { id: 'qi-2', generatedQuestionId: 'q-1', imageId: 'img-2', altText: 'B', caption: 'c', position: 'question_text', optionKey: null, width: 1, height: 2 },
    ]);
    storedImages.findByIds.mockResolvedValue([
      { id: 'img-1', storageKey: 'k1' },
      { id: 'img-2', storageKey: 'k2' },
    ]);

    const result = await service.listImagesForQuestions(['q-1']);
    expect(storedImages.findByIds).toHaveBeenCalledTimes(1);
    expect(result.get('q-1')).toHaveLength(2);
    expect(result.get('q-1')?.[0].storageKey).toBe('k1');
  });

  it('omits a question with no associations entirely (never an empty-array entry)', async () => {
    const { service } = make();
    await expect(service.listImagesForQuestions(['q-none'])).resolves.toEqual(new Map());
  });
});
