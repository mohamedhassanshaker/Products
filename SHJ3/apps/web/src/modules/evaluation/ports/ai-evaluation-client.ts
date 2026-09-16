/**
 * Calls `apps/ai`'s evaluation-execution endpoints (modelled on `modules/knowledge/ports/
 * knowledge-ai-client.ts` — this is the identical "web holds no vendor driver" boundary).
 *
 * ## Why this is two small calls, not one big "run the whole set" call
 *
 * `docs/api.md`'s originally-documented `POST /v1/evaluation/runs` shape (the AI side
 * owning an entire golden-set run end to end, returning a `202` + job) turns out not to
 * match this system's real, already-migrated SQL Server grants: `prisma/sql/002_tenant_
 * grants.sql` gives the AI service's role (`shj3_ai_ro`) INSERT/UPDATE on exactly
 * `ConversationTurns`/`OrchestrationTraces`/`OrchestrationTraceSteps`/`GroundingCitations`/
 * `ReindexJobs` — nothing else. It cannot create the synthetic `Conversation` a case needs,
 * and cannot write `RegressionRun`/`RegressionCaseResult`/`GoldenSet.lastScore` itself. Only
 * `shj3_app` (this web tier's own Prisma role) has full DML across the tenant schema. So
 * this module owns every write `docs/api.md` originally assigned to the AI side, and calls
 * `apps/ai` only for the two things that genuinely have to happen there: running the real
 * orchestration pipeline (guardrails/retrieval/tool-calling — reusing it, not re-implementing
 * it a second time) and computing a real embedding similarity (the model client already
 * lives there). `application/run-golden-set-now.ts` is the orchestrator that calls both,
 * once per `GoldenCase`, and owns every persistence step around them.
 */

export interface EvaluationTurnToolCall {
  /** `null` for a trace step whose own binding could not be resolved (should not happen
   *  in practice — `CK_OrchestrationTraceSteps_toolCallHasBinding` requires every real
   *  `ToolCall` step to name one — but the wire type is honest about what the AI side
   *  actually returns rather than assuming). Excluded from tool-accuracy comparison. */
  readonly toolBindingId: string | null;
  readonly status: string;
}

/**
 * `status` is `process_turn.py`'s own `TurnStatus` wire vocabulary: `completed` | `refused`
 * | `blocked` | `escalated` | `failed` | `step_up_required`. `wasRefused` is the exact
 * signal `ConversationTurn.wasRefused` itself would carry — `status in (refused, blocked)`,
 * per `_finish()`'s own computation — read back directly rather than re-derived here, so
 * this module's refusal scoring can never silently disagree with the persisted row.
 */
export interface EvaluationTurnResult {
  readonly status: string;
  readonly messageText: string;
  readonly wasRefused: boolean;
  readonly groundingConfidence: number | null;
  readonly toolCalls: readonly EvaluationTurnToolCall[];
}

export interface ExecuteEvaluationTurnInput {
  readonly conversationId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly prompt: string;
  readonly locale: string;
  readonly turnOrdinal: number;
}

export interface AiEvaluationClient {
  /** `POST /v1/evaluation/turns` — one real turn, against the pinned `agentVersionId`, on
   *  an ALREADY-EXISTING `conversationId` this module created first (the AI side has no
   *  grant to create one). */
  executeTurn(input: ExecuteEvaluationTurnInput): Promise<EvaluationTurnResult>;

  /** `POST /v1/evaluation/score-similarity` — real cosine similarity between the actual
   *  response and a case's `expectedBehaviour`, via the same embedding client the retrieval
   *  pipeline already uses. `0..1`, clamped. */
  scoreSimilarity(actual: string, expected: string): Promise<number>;
}
