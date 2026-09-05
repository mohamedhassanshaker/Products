import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { TRANSCRIPT_PURGE_QUEUE } from '../domain/queue-names';
import { PurgeExpiredTranscriptsUseCase } from '../../session-logs';

/**
 * BullMQ worker for the `transcript-purge` repeatable job (LLD §8.8,
 * FR-PRIV-3). Idempotent — a session already flagged `transcript_purged`
 * is never touched again, so overlapping runs across `web` replicas are
 * harmless.
 */
@Processor(TRANSCRIPT_PURGE_QUEUE)
export class TranscriptPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptPurgeProcessor.name);

  constructor(private readonly purge: PurgeExpiredTranscriptsUseCase) {
    super();
  }

  /** @param job - BullMQ job instance (no payload) */
  async process(job: Job): Promise<{ purged: number }> {
    const purged = await this.purge.execute();
    this.logger.log({ jobId: job.id, purged }, 'transcript-purge run complete');
    return { purged };
  }
}
