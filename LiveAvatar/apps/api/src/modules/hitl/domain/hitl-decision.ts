/** R-H6 — the reviewer's full context for one gate hit. */
export interface HitlProposedActionRecord {
  kind: 'tool_call' | 'spoken_text';
  summary: string;
  arguments?: Record<string, unknown>;
  transcriptExcerpt?: string[];
  callerIdentity?: string;
  retrievedSources?: string[];
  modelReasoning?: string;
}

export type HitlDecisionStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'edited_approved'
  | 'timed_out'
  | 'escalated'
  | 'deferred';

/**
 * `HitlDecision` aggregate (Phase 14, BL-052/053; `ARCHITECTURE_NOTES.md`
 * §6.1/§6.3) — simultaneously the R-H7 audit trail, the live reviewer queue
 * (`decision: 'pending'`), and the R-H10 metrics source. Created the moment
 * the interpreter enters a HITL node; resolved exactly once.
 */
export interface HitlDecisionRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  gateId: string;
  utteranceSeq: number;
  proposedAction: HitlProposedActionRecord;
  reviewerId: string | null;
  decision: HitlDecisionStatus;
  editedArguments: Record<string, unknown> | null;
  justificationNote: string | null;
  decidedAt: Date | null;
  latencyMs: number | null;
  outcomeNotifiedAt: Date | null;
  createdAt: Date;
}
