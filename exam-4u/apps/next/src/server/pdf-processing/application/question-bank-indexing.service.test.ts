import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingsPort, VectorStorePort } from '@/server/vector';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { ExamTypeQuestionEntity } from '@/server/infrastructure/database';
import { QuestionBankIndexingService } from './question-bank-indexing.service';

function fakeQuestion(overrides: Partial<ExamTypeQuestionEntity> = {}): ExamTypeQuestionEntity {
  return Object.assign(new ExamTypeQuestionEntity(), {
    id: 'q1',
    examTypeId: 'exam-1',
    moduleName: 'Module A',
    questionKey: 'gq_abc',
    questionText: 'What is 2+2?',
    optionsJson: { A: '4', B: '5' },
    correctAnswer: 'A',
    explanation: null,
    sourceGeneratedQuestionId: 'abc',
    ...overrides,
  });
}

function fakeVectorStore(overrides: Partial<VectorStorePort> = {}): VectorStorePort {
  return { upsertQuestions: vi.fn().mockResolvedValue(undefined), ...overrides } as unknown as VectorStorePort;
}

function fakeEmbeddings(vectors: number[][] = [[0.1, 0.2]]): EmbeddingsPort {
  return { embed: vi.fn().mockResolvedValue(vectors) } as unknown as EmbeddingsPort;
}

function fakeAdapter(): QdrantVectorStoreAdapter {
  return { pointId: vi.fn((tenantId: string, key: string) => `${tenantId}::${key}`) } as unknown as QdrantVectorStoreAdapter;
}

describe('QuestionBankIndexingService (scope-adjustment: real finalize/append writer, sub-slice "6c")', () => {
  it('is a no-op for an empty question list — never embeds or upserts', async () => {
    const embeddings = fakeEmbeddings();
    const vectorStore = fakeVectorStore();
    const service = new QuestionBankIndexingService(vectorStore, embeddings, fakeAdapter());

    await service.indexQuestions('tenant-1', 'exam-1', 'Sample Exam', []);

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(vectorStore.upsertQuestions).not.toHaveBeenCalled();
  });

  it('embeds question text and upserts one point per question, keyed by pointId(tenantId, examTypeId/questionKey)', async () => {
    const embeddings = fakeEmbeddings([[0.1, 0.2, 0.3]]);
    const vectorStore = fakeVectorStore();
    const adapter = fakeAdapter();
    const service = new QuestionBankIndexingService(vectorStore, embeddings, adapter);

    await service.indexQuestions('tenant-1', 'exam-1', 'Sample Exam', [fakeQuestion()]);

    expect(embeddings.embed).toHaveBeenCalledWith(['What is 2+2?']);
    expect(adapter.pointId).toHaveBeenCalledWith('tenant-1', 'exam-1/gq_abc');
    expect(vectorStore.upsertQuestions).toHaveBeenCalledWith(
      { tenantId: 'tenant-1' },
      [
        expect.objectContaining({
          id: 'tenant-1::exam-1/gq_abc',
          vector: [0.1, 0.2, 0.3],
          payload: expect.objectContaining({
            examTypeId: 'exam-1',
            examTypeName: 'Sample Exam',
            questionKey: 'gq_abc',
            moduleName: 'Module A',
            questionText: 'What is 2+2?',
            kind: 'exam_type_question',
          }),
        }),
      ],
    );
  });

  it('best-effort: swallows an embeddings-provider failure rather than throwing (finalize/append must never fail because of this)', async () => {
    const embeddings: EmbeddingsPort = { embed: vi.fn().mockRejectedValue(new Error('embeddings down')) } as unknown as EmbeddingsPort;
    const vectorStore = fakeVectorStore();
    const service = new QuestionBankIndexingService(vectorStore, embeddings, fakeAdapter());

    await expect(service.indexQuestions('tenant-1', 'exam-1', 'Sample Exam', [fakeQuestion()])).resolves.toBeUndefined();
    expect(vectorStore.upsertQuestions).not.toHaveBeenCalled();
  });

  it('best-effort: swallows a vector-store upsert failure rather than throwing', async () => {
    const vectorStore = fakeVectorStore({ upsertQuestions: vi.fn().mockRejectedValue(new Error('qdrant down')) });
    const service = new QuestionBankIndexingService(vectorStore, fakeEmbeddings(), fakeAdapter());

    await expect(service.indexQuestions('tenant-1', 'exam-1', 'Sample Exam', [fakeQuestion()])).resolves.toBeUndefined();
  });
});
