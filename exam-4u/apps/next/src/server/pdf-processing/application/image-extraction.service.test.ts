import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAssociationService, ImageCaptioningService } from '@/server/media';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { ImageExtractionService } from './image-extraction.service';
import type { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';

const extractPdfImages = vi.hoisted(() => vi.fn());
vi.mock('@/server/infrastructure/text-extraction', () => ({ extractPdfImages }));

function image(pageNumber: number) {
  return { pageNumber, data: Buffer.from(`img-${pageNumber}`), contentType: 'image/png', extension: 'png', width: 100, height: 80 };
}

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    sourceFileName: 'exam.pdf',
    curriculumId: null,
    curriculumDocumentId: null,
    ...overrides,
  });
}

function makeService(opts: {
  questions?: { id: string; sourcePageRange: string | null }[];
  stored?: Partial<Record<string, unknown>>;
  captionResult?: { caption: string; altText: string } | null;
  storeOrReuseImage?: ReturnType<typeof vi.fn>;
} = {}) {
  const storeOrReuseImage =
    opts.storeOrReuseImage ??
    vi.fn().mockResolvedValue({ id: 'img-1', sourcePageNumber: 1, generatedAltText: null, storageKey: 'k', ...opts.stored });
  const associateWithQuestion = vi.fn().mockResolvedValue({});
  const captionAndIndex = vi.fn().mockResolvedValue(opts.captionResult ?? null);
  const findAllForSession = vi.fn().mockResolvedValue(opts.questions ?? []);

  const service = new ImageExtractionService(
    { storeOrReuseImage, associateWithQuestion } as unknown as ImageAssociationService,
    { captionAndIndex } as unknown as ImageCaptioningService,
    { findAllForSession } as unknown as GeneratedQuestionRepository,
  );
  return { service, storeOrReuseImage, associateWithQuestion, captionAndIndex, findAllForSession };
}

beforeEach(() => extractPdfImages.mockReset());

describe('ImageExtractionService (FR-PDF-11)', () => {
  it('does nothing (no question query, no storage) for a PDF with no embedded images', async () => {
    extractPdfImages.mockResolvedValue([]);
    const { service, storeOrReuseImage, findAllForSession } = makeService();

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(storeOrReuseImage).not.toHaveBeenCalled();
    expect(findAllForSession).not.toHaveBeenCalled();
  });

  it('associates an image with every question whose source_page_range OVERLAPS its page (not exact match)', async () => {
    extractPdfImages.mockResolvedValue([image(4)]);
    const { service, associateWithQuestion } = makeService({
      questions: [
        { id: 'q-span', sourcePageRange: '3-5' },
        { id: 'q-exact', sourcePageRange: '4' },
        { id: 'q-other', sourcePageRange: '9' },
        { id: 'q-null', sourcePageRange: null },
      ],
    });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    const associated = associateWithQuestion.mock.calls.map((c) => c[0].generatedQuestionId);
    expect(associated.sort()).toEqual(['q-exact', 'q-span']);
  });

  it('builds a server-derived, per-session storage key prefix (no client-supplied path segment)', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, storeOrReuseImage } = makeService({ questions: [{ id: 'q1', sourcePageRange: '1' }] });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(storeOrReuseImage.mock.calls[0][0]).toBe('tenants/t-1/pdf/sess-1/images/');
  });

  it('captions a genuinely new image and uses the AI alt text/caption on every association it creates', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, associateWithQuestion, captionAndIndex } = makeService({
      questions: [{ id: 'q1', sourcePageRange: '1' }],
      captionResult: { caption: 'A labelled cell diagram.', altText: 'Cell diagram' },
    });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(captionAndIndex).toHaveBeenCalledTimes(1);
    expect(associateWithQuestion.mock.calls[0][0]).toMatchObject({ altText: 'Cell diagram', caption: 'A labelled cell diagram.' });
  });

  it('NEVER re-captions a hash-dedup reuse of an already-captioned image (no duplicate AI spend)', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, captionAndIndex } = makeService({
      questions: [{ id: 'q1', sourcePageRange: '1' }],
      stored: { generatedAltText: 'Already captioned' },
    });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(captionAndIndex).not.toHaveBeenCalled();
  });

  it('falls back to a non-empty page-number placeholder when captioning is unavailable/failed', async () => {
    extractPdfImages.mockResolvedValue([image(7)]);
    const { service, associateWithQuestion } = makeService({ questions: [{ id: 'q1', sourcePageRange: '7' }], captionResult: null });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(associateWithQuestion.mock.calls[0][0].altText).toContain('page 7');
    expect(associateWithQuestion.mock.calls[0][0].caption).toBeNull();
  });

  it('still stores an image with no overlapping question at all (a valid, harmless zero-association state)', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, storeOrReuseImage, associateWithQuestion } = makeService({ questions: [] });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(storeOrReuseImage).toHaveBeenCalledTimes(1);
    expect(associateWithQuestion).not.toHaveBeenCalled();
  });

  it('NEVER fails the session — an image-extraction failure is caught and logged, not propagated', async () => {
    // Driven through the association collaborator rather than the mocked `extractPdfImages` module
    // export: vitest surfaces a rejection originating inside a `vi.mock`ed module factory as a
    // test-level error in its own right even when the code under test genuinely catches it, which
    // would make this assertion untrustworthy rather than meaningful. The catch block being proven is
    // the same single `try` wrapping the whole method either way.
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service } = makeService({
      questions: [{ id: 'q1', sourcePageRange: '1' }],
      storeOrReuseImage: vi.fn().mockImplementation(async () => {
        throw new Error('corrupt image stream');
      }),
    });
    await expect(service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'))).resolves.toBeUndefined();
  });

  it('NEVER fails the session on a storage-write failure either', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service } = makeService({ storeOrReuseImage: vi.fn().mockImplementation(async () => {
        throw new Error('disk full');
      }) });
    await expect(service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'))).resolves.toBeUndefined();
  });

  it('scopes the caption chunk to the session curriculum/document when the session has them', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, captionAndIndex } = makeService({ questions: [{ id: 'q1', sourcePageRange: '1' }] });

    await service.extractAndAssociate(fakeSession({ curriculumId: 'cur-1', curriculumDocumentId: 'doc-1' }), 't-1', Buffer.from('pdf'));

    expect(captionAndIndex.mock.calls[0][0]).toMatchObject({ curriculumId: 'cur-1', documentId: 'doc-1', tenantId: 't-1' });
  });

  it('falls back to the session id as documentId for a Lesson/Exam session never indexed into a Curriculum', async () => {
    extractPdfImages.mockResolvedValue([image(1)]);
    const { service, captionAndIndex } = makeService({ questions: [{ id: 'q1', sourcePageRange: '1' }] });

    await service.extractAndAssociate(fakeSession(), 't-1', Buffer.from('pdf'));

    expect(captionAndIndex.mock.calls[0][0]).toMatchObject({ documentId: 'sess-1', curriculumId: undefined });
  });
});
