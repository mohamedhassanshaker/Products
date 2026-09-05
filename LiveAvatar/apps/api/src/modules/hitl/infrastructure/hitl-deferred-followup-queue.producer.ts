import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { HITL_DEFERRED_FOLLOWUP_QUEUE, type HitlDeferredFollowupQueuePort } from '../domain/ports';

/** Producer side of the `hitl-deferred-followup` BullMQ queue — mirrors `KnowledgeIngestQueueProducer`'s exact shape/rationale. */
@Injectable()
export class HitlDeferredFollowupQueueProducer implements HitlDeferredFollowupQueuePort {
  constructor(@InjectQueue(HITL_DEFERRED_FOLLOWUP_QUEUE) private readonly queue: Queue) {}

  async enqueue(input: { tenantId: string; decisionId: string }): Promise<void> {
    await this.queue.add('follow-up', input, {
      jobId: `hitl-deferred-followup-${input.decisionId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
