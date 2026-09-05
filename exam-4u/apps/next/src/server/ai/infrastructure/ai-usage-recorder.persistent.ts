import { randomUUID } from 'node:crypto';
import { AiCallLogEntity } from '@/server/infrastructure/database';
import { logger } from '@/server/logging';
import type { AiUsageRecord, AiUsageRecorderPort } from '../domain/ai-usage-recorder.port';
import { AiCallLogRepository } from './ai-call-log.repository';

/**
 * The real, persistence-backed {@link AiUsageRecorderPort} implementation (migration plan Phase 5's
 * own "AI cost accounting" line) — adapted from
 * `legacy/api/src/infrastructure/ai/ai-service/ai-usage-recorder.persistent.adapter.ts`. Unlike
 * legacy's own phased history (a logging-only stub later replaced by a real persistence-backed
 * implementation), this dispatch ships the real thing directly since there is no equivalent
 * phase-split constraint in this migration.
 *
 * **Fire-and-forget, fail-safe**: `record()` is synchronous (`void`, not `Promise<void>`) per the
 * port interface, so the actual DB insert runs detached — its resulting promise is deliberately not
 * returned, only `.catch()`-guarded, so a slow/failed write never makes the caller (`AiService`)
 * await it, and a failure here can never throw into the AI call site that triggered it (this
 * project's project-wide fail-safe-logging rule, applied to persistence instead of a log line).
 */
export class PersistentAiUsageRecorder implements AiUsageRecorderPort {
  constructor(private readonly repository: AiCallLogRepository) {}

  record(entry: AiUsageRecord): void {
    const row = new AiCallLogEntity();
    row.id = randomUUID();
    row.processingSessionId = entry.processingSessionId ?? null;
    row.task = entry.operation;
    row.model = entry.usage.model;
    row.promptTokens = entry.usage.promptTokens;
    row.completionTokens = entry.usage.completionTokens;
    row.costUsd = entry.usage.costUsd;
    row.costUnavailable = entry.usage.costUnavailable;
    row.latencyMs = entry.usage.latencyMs;
    row.outcome = entry.ok ? 'Success' : 'Failed';
    row.error = entry.ok ? null : `droppedItems=${entry.droppedItems}`;
    row.correlationId = entry.correlationId;

    this.repository.insert(row).catch((err: unknown) => {
      // Fail-safe per the project-wide logging rule (see class doc comment): never let a
      // cost-accounting write failure throw into the AI call site that triggered it.
      logger.error({ err }, 'ai_usage_recorder.persist_failed');
    });
  }
}
