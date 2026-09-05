import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SESSION_SWEEPER_QUEUE } from '../domain/queue-names';
import { SweepAbandonedSessionsUseCase } from '../../sessions';

/**
 * BullMQ worker for the `session-sweeper` repeatable job (LLD §8.8,
 * FR-AUTH-4). Idempotent: re-abandoning an already-abandoned session is not
 * possible (`nextStatus` only allows `pending`→`abandoned`), so overlapping
 * runs across `web` replicas are harmless.
 */
@Processor(SESSION_SWEEPER_QUEUE)
export class SessionSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger(SessionSweeperProcessor.name);

  constructor(private readonly sweep: SweepAbandonedSessionsUseCase) {
    super();
  }

  /** @param job - BullMQ job instance (no payload) */
  async process(job: Job): Promise<{ abandoned: number }> {
    const abandoned = await this.sweep.execute();
    this.logger.log({ jobId: job.id, abandoned }, 'session-sweeper run complete');
    return { abandoned };
  }
}
