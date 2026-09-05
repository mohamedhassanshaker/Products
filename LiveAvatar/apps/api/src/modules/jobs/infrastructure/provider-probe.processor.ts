import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PROVIDER_PROBE_QUEUE } from '../domain/queue-names';
import { RunProviderProbeSweepUseCase } from '../application/run-provider-probe-sweep.use-case';

/**
 * BullMQ worker for the `provider-probe` repeatable job (LLD §8.7/§8.8).
 * Idempotent and safe under concurrent `web` replicas — BullMQ guarantees
 * single delivery per job id, and each credential re-check is itself
 * idempotent (it only overwrites the latest probe result).
 */
@Processor(PROVIDER_PROBE_QUEUE)
export class ProviderProbeProcessor extends WorkerHost {
  private readonly logger = new Logger(ProviderProbeProcessor.name);

  constructor(private readonly sweep: RunProviderProbeSweepUseCase) {
    super();
  }

  /** @param job - BullMQ job instance (no payload — sweeps every active tenant) */
  async process(job: Job): Promise<{ probed: number; failed: number }> {
    const result = await this.sweep.execute();
    this.logger.log({ jobId: job.id, ...result }, 'provider-probe sweep complete');
    return result;
  }
}
