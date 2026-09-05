import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ProvidersModule } from '../providers';
import { SessionsModule } from '../sessions';
import { SessionLogsModule } from '../session-logs';
import { KnowledgeModule } from '../knowledge';
import { ToolsModule } from '../tools';
import { HitlModule } from '../hitl';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import {
  HITL_DEFERRED_FOLLOWUP_QUEUE,
  HITL_SLA_SWEEP_INTERVAL_MS,
  HITL_SLA_SWEEP_QUEUE,
  KNOWLEDGE_INGEST_QUEUE,
  PROVIDER_PROBE_INTERVAL_MS,
  PROVIDER_PROBE_QUEUE,
  SESSION_SWEEPER_INTERVAL_MS,
  SESSION_SWEEPER_QUEUE,
  TRANSCRIPT_PURGE_INTERVAL_MS,
  TRANSCRIPT_PURGE_QUEUE,
} from './domain/queue-names';
import { RunProviderProbeSweepUseCase } from './application/run-provider-probe-sweep.use-case';
import { ProviderProbeProcessor } from './infrastructure/provider-probe.processor';
import { SessionSweeperProcessor } from './infrastructure/session-sweeper.processor';
import { TranscriptPurgeProcessor } from './infrastructure/transcript-purge.processor';
import { KnowledgeIngestProcessor } from './infrastructure/knowledge-ingest.processor';
import { HitlSlaSweepProcessor } from './infrastructure/hitl-sla-sweep.processor';
import { HitlDeferredFollowupProcessor } from './infrastructure/hitl-deferred-followup.processor';

/**
 * Scheduled-jobs bounded context (LLD §8.8). `provider-probe` (Phase 2),
 * `session-sweeper` (Phase 3, FR-AUTH-4), `transcript-purge` (Phase 7,
 * FR-PRIV-3), and `knowledge-ingest` (Phase 12a, BL-044/046 — on-demand, not
 * self-scheduled, see `queue-names.ts`) are in scope; `room-reaper` and the
 * broader `retention-prune` (AlertEvent/AuditLog/LatencyHop/IdempotencyRecord/
 * RefreshToken sweeps) are a distinct, still-unscheduled job and
 * deliberately not stubbed here.
 *
 * Phase 14 (BL-053/056) adds `hitl-sla-sweep` (self-scheduled, like
 * `session-sweeper`) and `hitl-deferred-followup` (on-demand, like
 * `knowledge-ingest` -- its queue is owned/registered by `HitlModule`, this
 * module registers the same name again only to get its own `Worker`, same
 * "Queue/Worker providers are module-scoped" precedent
 * `KnowledgeIngestQueueProducer`'s doc comment already explains).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      }),
    }),
    BullModule.registerQueue(
      { name: PROVIDER_PROBE_QUEUE },
      { name: SESSION_SWEEPER_QUEUE },
      { name: TRANSCRIPT_PURGE_QUEUE },
      { name: KNOWLEDGE_INGEST_QUEUE },
      { name: HITL_SLA_SWEEP_QUEUE },
      { name: HITL_DEFERRED_FOLLOWUP_QUEUE },
    ),
    ProvidersModule,
    SessionsModule,
    SessionLogsModule,
    KnowledgeModule,
    ToolsModule,
    HitlModule,
    NotificationsModule,
  ],
  providers: [
    RunProviderProbeSweepUseCase,
    ProviderProbeProcessor,
    SessionSweeperProcessor,
    TranscriptPurgeProcessor,
    KnowledgeIngestProcessor,
    HitlSlaSweepProcessor,
    HitlDeferredFollowupProcessor,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue(PROVIDER_PROBE_QUEUE) private readonly providerProbeQueue: Queue,
    @InjectQueue(SESSION_SWEEPER_QUEUE) private readonly sessionSweeperQueue: Queue,
    @InjectQueue(TRANSCRIPT_PURGE_QUEUE) private readonly transcriptPurgeQueue: Queue,
    @InjectQueue(HITL_SLA_SWEEP_QUEUE) private readonly hitlSlaSweepQueue: Queue,
  ) {}

  /**
   * Registers both repeatable jobs on boot. `jobId` makes re-registration on
   * every process start idempotent — BullMQ replaces rather than duplicates
   * a repeatable job with the same id + repeat options.
   */
  async onModuleInit(): Promise<void> {
    await this.providerProbeQueue.add(
      'sweep',
      {},
      {
        jobId: 'provider-probe-sweep',
        repeat: { every: PROVIDER_PROBE_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    await this.sessionSweeperQueue.add(
      'sweep',
      {},
      {
        jobId: 'session-sweeper-sweep',
        repeat: { every: SESSION_SWEEPER_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    await this.transcriptPurgeQueue.add(
      'purge',
      {},
      {
        jobId: 'transcript-purge-daily',
        repeat: { every: TRANSCRIPT_PURGE_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    await this.hitlSlaSweepQueue.add(
      'sweep',
      {},
      {
        jobId: 'hitl-sla-sweep-sweep',
        repeat: { every: HITL_SLA_SWEEP_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
