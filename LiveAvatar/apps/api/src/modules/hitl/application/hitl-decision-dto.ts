import type { HitlDecisionDto } from '@liveavatar/contracts';
import type { HitlDecisionRecord } from '../domain/hitl-decision';

/** Maps a `HitlDecision` record to its wire DTO. */
export function toHitlDecisionDto(record: HitlDecisionRecord): HitlDecisionDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    session_id: record.sessionId,
    gate_id: record.gateId,
    utterance_seq: record.utteranceSeq,
    proposed_action: {
      kind: record.proposedAction.kind,
      summary: record.proposedAction.summary,
      arguments: record.proposedAction.arguments,
      transcript_excerpt: record.proposedAction.transcriptExcerpt,
      caller_identity: record.proposedAction.callerIdentity,
      retrieved_sources: record.proposedAction.retrievedSources,
      model_reasoning: record.proposedAction.modelReasoning,
    },
    reviewer_id: record.reviewerId,
    decision: record.decision,
    edited_arguments: record.editedArguments,
    justification_note: record.justificationNote,
    decided_at: record.decidedAt ? record.decidedAt.toISOString() : null,
    latency_ms: record.latencyMs,
    outcome_notified_at: record.outcomeNotifiedAt ? record.outcomeNotifiedAt.toISOString() : null,
    created_at: record.createdAt.toISOString(),
  };
}
