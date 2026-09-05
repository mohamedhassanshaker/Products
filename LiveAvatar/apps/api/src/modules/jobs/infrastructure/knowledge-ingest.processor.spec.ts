import { KnowledgeIngestProcessor } from './knowledge-ingest.processor';

describe('KnowledgeIngestProcessor', () => {
  it('runs the ingestion use-case with the job payload', async () => {
    const runIngestion = { execute: jest.fn().mockResolvedValue(undefined) };
    const processor = new KnowledgeIngestProcessor(runIngestion as never);

    await processor.process({ id: 'job-1', data: { tenantId: 'tenant-1', sourceId: 'source-1' } } as never);

    expect(runIngestion.execute).toHaveBeenCalledWith('tenant-1', 'source-1');
    expect(runIngestion.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection from the use-case (so BullMQ records the attempt as failed)', async () => {
    const runIngestion = { execute: jest.fn().mockRejectedValue(new Error('boom')) };
    const processor = new KnowledgeIngestProcessor(runIngestion as never);

    await expect(
      processor.process({ id: 'job-2', data: { tenantId: 'tenant-1', sourceId: 'source-1' } } as never),
    ).rejects.toThrow('boom');
  });
});
