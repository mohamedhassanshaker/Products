import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { EmbeddingsPort, VectorStorePort } from '@/server/vector';
import { GeneratedQuestionEntity } from '@/server/infrastructure/database';
import { SimilarQuestionsService } from './similar-questions.service';
import { GeneratedQuestionNotFoundError } from '../domain/errors';
import type { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';

function fakeQuestion(overrides: Partial<GeneratedQuestionEntity> = {}): GeneratedQuestionEntity {
  return Object.assign(new GeneratedQuestionEntity(), { id: 'gq-1', questionText: 'What is the capital of France?', ...overrides });
}

function fakeRepo(question: GeneratedQuestionEntity | null): GeneratedQuestionRepository {
  return { findById: vi.fn().mockResolvedValue(question) } as unknown as GeneratedQuestionRepository;
}

function fakeEmbeddings(vector: number[] = [0.1, 0.2]): EmbeddingsPort {
  return { embed: vi.fn().mockResolvedValue([vector]) } as unknown as EmbeddingsPort;
}

function fakeVectorStore(points: { score: number; payload: Record<string, unknown> }[] = []): VectorStorePort {
  return { searchQuestions: vi.fn().mockResolvedValue(points) } as unknown as VectorStorePort;
}

describe('SimilarQuestionsService', () => {
  beforeEach(() => {
    process.env.SIMILAR_QUESTIONS_RELEVANCE_FLOOR = '0.75';
    process.env.SIMILAR_QUESTIONS_LIMIT = '5';
    // Force a fresh env cache per test (getEnv() caches on globalThis).
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });

  afterEach(() => {
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });

  it('throws GeneratedQuestionNotFoundError when no such question exists', async () => {
    const service = new SimilarQuestionsService(fakeRepo(null), fakeEmbeddings(), fakeVectorStore());
    await expect(service.findSimilar('tenant-1', 'missing')).rejects.toBeInstanceOf(GeneratedQuestionNotFoundError);
  });

  it('embeds the candidate question text and searches tenant-wide (empty QuestionFilter)', async () => {
    const embeddings = fakeEmbeddings([0.3, 0.4]);
    const vectorStore = fakeVectorStore([]);
    const service = new SimilarQuestionsService(fakeRepo(fakeQuestion()), embeddings, vectorStore);

    await service.findSimilar('tenant-1', 'gq-1');

    expect(embeddings.embed).toHaveBeenCalledWith(['What is the capital of France?']);
    expect(vectorStore.searchQuestions).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, [0.3, 0.4], {}, 5, 0.75);
  });

  it('maps ScoredPoint payloads into SimilarQuestionMatch, falling back for missing/malformed fields', async () => {
    const vectorStore = fakeVectorStore([
      { score: 0.91, payload: { examTypeName: 'Algebra I', moduleName: 'Equations', questionText: 'Solve for x' } },
      { score: 0.8, payload: {} },
    ]);
    const service = new SimilarQuestionsService(fakeRepo(fakeQuestion()), fakeEmbeddings(), vectorStore);

    const matches = await service.findSimilar('tenant-1', 'gq-1');

    expect(matches).toEqual([
      { score: 0.91, examTypeName: 'Algebra I', moduleName: 'Equations', questionText: 'Solve for x' },
      { score: 0.8, examTypeName: 'Unknown Exam Type', moduleName: 'Unknown module', questionText: '' },
    ]);
  });

  it('returns an empty array when no match clears the relevance floor', async () => {
    const service = new SimilarQuestionsService(fakeRepo(fakeQuestion()), fakeEmbeddings(), fakeVectorStore([]));
    await expect(service.findSimilar('tenant-1', 'gq-1')).resolves.toEqual([]);
  });
});
