/**
 * The wizard's "Test" step (Step 9) sandbox chat — `POST /v1/sandbox/turns`
 * (`apps/ai`'s `sandbox_router.py`). Runs the real `ProcessTurn`/`ExecuteFlowStep` pipeline
 * against the CURRENT DRAFT flow version being edited (never the last Published one, which
 * is what every other real conversation path in this codebase resolves to) — see that
 * router's own module doc comment for exactly how it seeds flow state to make that safe with
 * zero changes to `ProcessTurn`'s own core logic.
 *
 * Deliberately writes NO real `Conversations`/`ConversationTurns`/`OrchestrationTraces`/
 * `GroundingCitations`/`EscalationTickets` rows — `sandbox_router.py`'s own
 * `InMemorySandboxOrchestrationStore` is what makes that guarantee hold on the far side; this
 * port is just the wire shape for it. A bound `ApiConnector` tool call is simulated, never
 * really invoked, for the same reason (`SandboxToolInvoker`).
 *
 * Response shape mirrors `apps/ai`'s own `TurnEnvelopeOut` (`conversation_router.py`) field
 * for field — the real citizen-facing turn envelope, reused directly rather than the
 * narrower `evaluation_router.EvaluationTurnOut` (built for golden-set pass/fail scoring, not
 * interactive flow debugging) — `flowState`/`trace.hops` are exactly what lets a sandbox UI
 * show a Draft flow's position advancing turn over turn, not just the final message text.
 */

export interface SandboxMessage {
  readonly role: string;
  readonly content: string;
  readonly suggestions: readonly string[];
}

export interface SandboxFlowState {
  readonly flowVersionId: string | null;
  readonly nodeKey: string | null;
  readonly slots: Readonly<Record<string, string>>;
  readonly awaitingSlot: string | null;
}

export interface SandboxTraceStep {
  readonly ordinal: number;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly durationMs: number;
  readonly agentId: string | null;
  readonly toolBindingId: string | null;
  readonly confidence: number | null;
  readonly errorCode: string | null;
  readonly isSecondaryAgent: boolean;
}

export interface SandboxTrace {
  readonly traceId: string;
  readonly mode: string;
  readonly hops: readonly SandboxTraceStep[];
  readonly degraded: readonly string[];
  readonly escapeTriggered: boolean;
  readonly usedFallbackModel: boolean;
}

export interface SandboxUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costAed: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
}

export interface SendSandboxTurnInput {
  readonly sandboxSessionId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly flowVersionId: string;
  readonly turnId: string;
  readonly turnOrdinal: number;
  readonly content: string;
  readonly locale: string;
}

export interface SendSandboxTurnResult {
  readonly turnId: string;
  readonly conversationId: string;
  readonly status: string;
  readonly message: SandboxMessage;
  readonly flowState: SandboxFlowState | null;
  readonly trace: SandboxTrace;
  readonly usage: SandboxUsage;
  readonly groundingConfidence: number | null;
}

export interface FlowSandboxClient {
  sendSandboxTurn(input: SendSandboxTurnInput): Promise<SendSandboxTurnResult>;
}
