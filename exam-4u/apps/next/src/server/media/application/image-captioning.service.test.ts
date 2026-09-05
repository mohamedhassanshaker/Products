import { describe, expect, it, vi } from 'vitest';
import { AiDisabledError, type AiServicePort } from '@/server/ai';
import type { EmbeddingsPort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { ImageCaptioningService } from './image-captioning.service';
import type { StoredImageRepository } from '../infrastructure/stored-image.repository';
import type { CaptionAndIndexInput } from '../domain/media.types';

function usage() {
  return { model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.01, costUnavailable: false, latencyMs: 1, attempts: 1 };
}

function make(opts: { available?: boolean; captionImage?: ReturnType<typeof vi.fn>; embed?: ReturnType<typeof vi.fn> } = {}) {
  const captionImage =
    opts.captionImage ?? vi.fn().mockResolvedValue({ data: { caption: 'A labelled cell diagram.', altText: 'Cell diagram' }, usage: usage(), droppedItems: 0 });
  const ai = { captionImage, available: opts.available ?? true } as unknown as AiServicePort;
  const upsertChunks = vi.fn().mockResolvedValue(undefined);
  const vectorAdapter = { upsertChunks, pointId: (t: string, k: string) => `${t}:${k}` } as unknown as QdrantVectorStoreAdapter;
  const embed = opts.embed ?? vi.fn().mockResolvedValue([[0.1, 0.2]]);
  const embeddings = { embed, model: 'test-embed-model' } as unknown as EmbeddingsPort;
  const updateGeneratedAltText = vi.fn().mockResolvedValue(undefined);
  const storedImages = { updateGeneratedAltText } as unknown as StoredImageRepository;

  return { service: new ImageCaptioningService(ai, vectorAdapter, embeddings, storedImages), captionImage, upsertChunks, embed, updateGeneratedAltText };
}

const INPUT: CaptionAndIndexInput = {
  tenantId: 't-1',
  processingSessionId: 'sess-1',
  storedImageId: 'img-1',
  sourcePageNumber: 4,
  imageBytes: Buffer.from('image-bytes'),
  mimeType: 'image/png',
  fileName: 'exam.pdf',
  curriculumId: 'cur-1',
  documentId: 'doc-1',
};

describe('ImageCaptioningService (FR-PDF-11 vision captioning + retrieval indexing)', () => {
  it('captions, persists the alt text, and indexes exactly one chunk for the caption', async () => {
    const { service, upsertChunks, updateGeneratedAltText } = make();

    await expect(service.captionAndIndex(INPUT)).resolves.toEqual({ caption: 'A labelled cell diagram.', altText: 'Cell diagram' });
    expect(updateGeneratedAltText).toHaveBeenCalledWith('img-1', 'Cell diagram');
    expect(upsertChunks).toHaveBeenCalledTimes(1);
    expect(upsertChunks.mock.calls[0][1]).toHaveLength(1);
  });

  it('writes the SAME chunk payload vocabulary the text-chunk writers use, so retrieval reads it unchanged', async () => {
    const { service, upsertChunks } = make();
    await service.captionAndIndex(INPUT);

    expect(upsertChunks.mock.calls[0][0]).toEqual({ tenantId: 't-1' });
    expect(upsertChunks.mock.calls[0][1][0].payload).toMatchObject({
      curriculumId: 'cur-1',
      documentId: 'doc-1',
      pageNumber: 4,
      chunkIndex: -1,
      fileName: 'exam.pdf',
      text: 'A labelled cell diagram.',
      embeddingModel: 'test-embed-model',
      isImageCaption: true,
      imageId: 'img-1',
    });
  });

  it('omits curriculumId entirely (never writes a literal null) for an unscoped session', async () => {
    const { service, upsertChunks } = make();
    await service.captionAndIndex({ ...INPUT, curriculumId: undefined });
    expect('curriculumId' in upsertChunks.mock.calls[0][1][0].payload).toBe(false);
  });

  it('embeds the CAPTION text (the whole point of indexing an image for retrieval)', async () => {
    const { service, embed } = make();
    await service.captionAndIndex(INPUT);
    expect(embed).toHaveBeenCalledWith(['A labelled cell diagram.']);
  });

  it('sends the image as base64 with an unbudgeted, advisory-only budget hint', async () => {
    const { service, captionImage } = make();
    await service.captionAndIndex(INPUT);
    expect(captionImage.mock.calls[0][0]).toEqual({ imageBase64: Buffer.from('image-bytes').toString('base64'), mimeType: 'image/png' });
    expect(captionImage.mock.calls[0][1]).toMatchObject({ tenantId: 't-1', processingSessionId: 'sess-1' });
  });

  it('returns null immediately when AI is disabled — no call, no embed, no upsert', async () => {
    const { service, captionImage, upsertChunks } = make({ available: false });
    await expect(service.captionAndIndex(INPUT)).resolves.toBeNull();
    expect(captionImage).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });

  it('degrades to null when the engine produced nothing usable (droppedItems > 0), writing nothing', async () => {
    const captionImage = vi.fn().mockResolvedValue({ data: null, usage: usage(), droppedItems: 1 });
    const { service, upsertChunks, updateGeneratedAltText } = make({ captionImage });

    await expect(service.captionAndIndex(INPUT)).resolves.toBeNull();
    expect(updateGeneratedAltText).not.toHaveBeenCalled();
    expect(upsertChunks).not.toHaveBeenCalled();
  });

  it('degrades to null (never throws) on an AI outage', async () => {
    const captionImage = vi.fn().mockImplementation(async () => {
      throw new AiDisabledError();
    });
    const { service } = make({ captionImage });
    await expect(service.captionAndIndex(INPUT)).resolves.toBeNull();
  });

  it('degrades to null (never throws) on a transient embeddings/Qdrant failure', async () => {
    const embed = vi.fn().mockImplementation(async () => {
      throw new Error('embeddings endpoint down');
    });
    const { service } = make({ embed });
    await expect(service.captionAndIndex(INPUT)).resolves.toBeNull();
  });

  it('falls back to page 0 in the payload for an image with no recorded source page', async () => {
    const { service, upsertChunks } = make();
    await service.captionAndIndex({ ...INPUT, sourcePageNumber: null });
    expect(upsertChunks.mock.calls[0][1][0].payload.pageNumber).toBe(0);
  });
});
