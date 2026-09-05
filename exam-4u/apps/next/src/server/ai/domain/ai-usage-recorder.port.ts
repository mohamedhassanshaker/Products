import type { AiUsage } from './ai-service.port';

/** Everything `AiUsageRecorderPort.record()` needs to attribute a usage row (`ai_call_log`'s
 * columns: tokens/cost/model/latency per call) — ported verbatim from
 * `legacy/api/src/ai/domain/ai-usage-recorder.port.ts`. */
export interface AiUsageRecord {
  tenantId: string;
  operation: string;
  correlationId: string;
  processingSessionId?: string;
  userId?: string;
  usage: AiUsage;
  ok: boolean;
  droppedItems: number;
}

/**
 * Cost/token accounting sink for every `AiService` call (migration plan Phase 5's own "AI cost
 * accounting" line). Unlike legacy's own phased history (a logging-only Dev-14-era stub later
 * replaced by Dev-18a's real persistence), this dispatch ships the real, persistence-backed
 * implementation directly — there is no equivalent phase-split constraint here.
 */
export interface AiUsageRecorderPort {
  record(entry: AiUsageRecord): void;
}
