import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { KNOWLEDGE_INGEST_QUEUE, type KnowledgeIngestQueuePort } from '../domain/ports';

/**
 * Producer side of the `knowledge-ingest` BullMQ queue. `KnowledgeModule`
 * registers this queue itself (`BullModule.registerQueue({ name:
 * KNOWLEDGE_INGEST_QUEUE })`) rather than importing `JobsModule` (wrong
 * dependency direction — domain modules never import `JobsModule`,
 * `JobsModule` imports domain modules). The Redis connection config is
 * shared app-wide because `@nestjs/bullmq`'s `BullModule.forRootAsync(...)`
 * (called once, in `JobsModule`) returns a `{ global: true }` dynamic
 * module — confirmed by reading the installed package source
 * (`@nestjs/bullmq@11.0.5`'s `bull.module.js`) — so a second `forRootAsync`
 * call here is unnecessary; only the queue-specific `registerQueue` needs
 * to be repeated per consuming module (`Queue`/`Worker` providers are
 * module-scoped, unlike the shared connection config).
 */
@Injectable()
export class KnowledgeIngestQueueProducer implements KnowledgeIngestQueuePort {
  constructor(@InjectQueue(KNOWLEDGE_INGEST_QUEUE) private readonly queue: Queue) {}

  /** @inheritdoc */
  async enqueue(input: { tenantId: string; sourceId: string }): Promise<void> {
    await this.queue.add('ingest', input, {
      jobId: `knowledge-ingest-${input.tenantId}-${input.sourceId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
