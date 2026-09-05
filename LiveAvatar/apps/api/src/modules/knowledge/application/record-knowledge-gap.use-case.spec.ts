import type { KnowledgeGapRepositoryPort } from '../domain/ports';
import { RecordKnowledgeGapUseCase } from './record-knowledge-gap.use-case';

describe('RecordKnowledgeGapUseCase', () => {
  let gaps: jest.Mocked<KnowledgeGapRepositoryPort>;
  let useCase: RecordKnowledgeGapUseCase;

  beforeEach(() => {
    gaps = { record: jest.fn() };
    useCase = new RecordKnowledgeGapUseCase(gaps);
  });

  it('records a gap with the given source id and best score', async () => {
    await useCase.execute({ tenant_id: 'tenant-1', source_id: 'source-1', query: 'refund after 30 days', best_score: 0.42 });
    expect(gaps.record).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      sourceId: 'source-1',
      query: 'refund after 30 days',
      bestScore: 0.42,
    });
  });

  it('defaults an absent source id / best score to null (no candidates matched at all)', async () => {
    await useCase.execute({ tenant_id: 'tenant-1', query: 'refund after 30 days' });
    expect(gaps.record).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      sourceId: null,
      query: 'refund after 30 days',
      bestScore: null,
    });
  });
});
