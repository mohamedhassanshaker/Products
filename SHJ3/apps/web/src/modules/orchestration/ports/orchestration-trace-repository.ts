import type {
  ExecutionMode,
  GuardrailResult,
  TraceStepKind,
  TraceStepStatus,
} from "../domain/router-config-vocabulary.js";

/** One row of the picker list — a real, recent `OrchestrationTraces` row, joined just
 *  enough to be identifiable without opening the detail (§ "let an admin pick a recent
 *  real conversation/turn"). */
export interface OrchestrationTraceSummaryRow {
  readonly id: string;
  readonly conversationId: string;
  readonly channelKey: string;
  readonly executionMode: ExecutionMode;
  readonly routedAgentId: string | null;
  readonly routedAgentName: string | null;
  readonly routingConfidence: number | null;
  readonly hopCount: number;
  readonly guardrailPreResult: GuardrailResult;
  readonly guardrailPostResult: GuardrailResult;
  readonly startedAt: Date;
  readonly durationMs: number;
}

/** One real `OrchestrationTraceSteps` row, in trace order. */
export interface OrchestrationTraceStepRow {
  readonly id: string;
  readonly ordinal: number;
  readonly kind: TraceStepKind;
  readonly agentId: string | null;
  readonly agentName: string | null;
  readonly toolBindingId: string | null;
  readonly label: string;
  readonly argumentsMasked: string | null;
  readonly resultSummary: string | null;
  readonly confidence: number | null;
  readonly status: TraceStepStatus;
  readonly errorCode: string | null;
  readonly isSecondaryAgent: boolean;
  readonly durationMs: number;
}

/** One real `GroundingCitations` row — what grounded the answer, if retrieval ran. */
export interface GroundingCitationRow {
  readonly id: string;
  readonly rank: number;
  readonly chunkId: string;
  readonly hybridScore: number;
  readonly retrievedVia: string;
  readonly wasCited: boolean;
}

/** The real prompt/response pair a trace answered — the two `ConversationTurns` rows either
 *  side of the trace's own assistant turn (§ "read these three models directly... for the
 *  exact real column list"; the citizen turn is a sibling row, not a column on the trace
 *  itself, so this is resolved as a second, explicit lookup rather than assumed joinable). */
export interface OrchestrationTraceDetail extends OrchestrationTraceSummaryRow {
  readonly promptTextMasked: string | null;
  readonly responseTextMasked: string;
  readonly mergePolicyApplied: string | null;
  readonly groundingConfidence: number | null;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostMicroAed: number;
  readonly escapeTriggered: boolean;
  readonly steps: readonly OrchestrationTraceStepRow[];
  readonly citations: readonly GroundingCitationRow[];
}

export interface OrchestrationTraceRepository {
  listRecent(limit: number): Promise<readonly OrchestrationTraceSummaryRow[]>;

  /** `null` when no trace with this id exists. */
  getDetail(traceId: string): Promise<OrchestrationTraceDetail | null>;
}
