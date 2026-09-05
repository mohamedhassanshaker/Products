import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RunKnowledgeIngestionUseCase } from '../../knowledge';
import { KNOWLEDGE_INGEST_QUEUE } from '../domain/queue-names';

/**
 * BullMQ worker for the on-demand `knowledge-ingest` job (Phase 12a,
 * BL-044/046) — mirrors `ProviderProbeProcessor`'s exact shape. Unlike the
 * other processors in this module, this queue is not self-scheduled
 * (`JobsModule.onModuleInit` never calls `.add()` for it); jobs arrive only
 * via `KnowledgeIngestQueuePort.enqueue(...)` (the `knowledge` module's
 * producer) on source create or a confirmed re-index.
 */
@Processor(KNOWLEDGE_INGEST_QUEUE)
export class KnowledgeIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeIngestProcessor.name);

  constructor(private readonly runIngestion: RunKnowledgeIngestionUseCase) {
    super();
  }

  /** @param job - `{ tenantId, sourceId }` payload from `KnowledgeIngestQueueProducer.enqueue` */
  async process(job: Job<{ tenantId: string; sourceId: string }>): Promise<void> {
    const { tenantId, sourceId } = job.data;
    // Never log chunk text, embeddings, or a resolved credential — only ids.
    this.logger.log({ jobId: job.id, tenantId, sourceId }, 'knowledge-ingest job starting');
    await this.runIngestion.execute(tenantId, sourceId);
  }
}
