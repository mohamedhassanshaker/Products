import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  ExecutionMode,
  GuardrailResult,
  TraceStepKind,
  TraceStepStatus,
} from "../../../domain/router-config-vocabulary.js";
import type {
  GroundingCitationRow,
  OrchestrationTraceDetail,
  OrchestrationTraceRepository,
  OrchestrationTraceStepRow,
  OrchestrationTraceSummaryRow,
} from "../../../ports/orchestration-trace-repository.js";

/** Shared select/include shape for the summary fields both `listRecent` and `getDetail`
 *  need, so the two queries cannot silently diverge on which columns/joins back a summary
 *  row — the same "one function both callers share" discipline
 *  `diff-trace-viewer-types.ts`'s `groupTraceSteps` already uses for its own render/test
 *  pair, applied here to a query shape instead of a pure function. */
function toSummaryRow(row: {
  id: string;
  conversationId: string;
  executionMode: string;
  routedAgentId: string | null;
  routingConfidence: unknown;
  hopCount: number;
  guardrailPreResult: string;
  guardrailPostResult: string;
  startedAt: Date;
  durationMs: number;
  routedAgent: { name: string } | null;
  conversation: { channelKey: string };
}): OrchestrationTraceSummaryRow {
  return {
    id: row.id,
    conversationId: row.conversationId,
    channelKey: row.conversation.channelKey,
    executionMode: row.executionMode as ExecutionMode,
    routedAgentId: row.routedAgentId,
    routedAgentName: row.routedAgent?.name ?? null,
    routingConfidence: row.routingConfidence === null ? null : Number(row.routingConfidence),
    hopCount: row.hopCount,
    guardrailPreResult: row.guardrailPreResult as GuardrailResult,
    guardrailPostResult: row.guardrailPostResult as GuardrailResult,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
  };
}

export class PrismaOrchestrationTraceRepository implements OrchestrationTraceRepository {
  async listRecent(limit: number): Promise<readonly OrchestrationTraceSummaryRow[]> {
    const rows = await getTenantDb("orchestration trace list").orchestrationTrace.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        routedAgent: { select: { name: true } },
        conversation: { select: { channelKey: true } },
      },
    });
    return rows.map(toSummaryRow);
  }

  async getDetail(traceId: string): Promise<OrchestrationTraceDetail | null> {
    const db = getTenantDb("orchestration trace detail");
    const row = await db.orchestrationTrace.findUnique({
      where: { id: traceId },
      include: {
        routedAgent: { select: { name: true } },
        conversation: { select: { channelKey: true } },
        turn: { select: { contentMasked: true, ordinal: true, conversationId: true } },
        steps: {
          orderBy: { ordinal: "asc" },
          include: { agent: { select: { name: true } } },
        },
        citations: { orderBy: { rank: "asc" } },
      },
    });
    if (!row) return null;

    // The turn's citizen prompt is a sibling `ConversationTurns` row, not a column on the
    // trace itself (`OrchestrationTraces.turnId` points at the *assistant* turn `_finish`
    // persists — confirmed by reading `process_turn.py` directly) — the most recent
    // `Citizen`-role turn strictly before it is the real prompt this trace answered.
    const promptTurn = await db.conversationTurn.findFirst({
      where: {
        conversationId: row.turn.conversationId,
        role: "Citizen",
        ordinal: { lt: row.turn.ordinal },
      },
      orderBy: { ordinal: "desc" },
      select: { contentMasked: true },
    });

    const steps: OrchestrationTraceStepRow[] = row.steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      kind: step.kind as TraceStepKind,
      agentId: step.agentId,
      agentName: step.agent?.name ?? null,
      toolBindingId: step.toolBindingId,
      label: step.label,
      argumentsMasked: step.argumentsMasked,
      resultSummary: step.resultSummary,
      confidence: step.confidence === null ? null : Number(step.confidence),
      status: step.status as TraceStepStatus,
      errorCode: step.errorCode,
      isSecondaryAgent: step.isSecondaryAgent,
      durationMs: step.durationMs,
    }));

    const citations: GroundingCitationRow[] = row.citations.map((citation) => ({
      id: citation.id,
      rank: citation.rank,
      chunkId: citation.chunkId,
      hybridScore: Number(citation.hybridScore),
      retrievedVia: citation.retrievedVia,
      wasCited: citation.wasCited,
    }));

    return {
      ...toSummaryRow(row),
      promptTextMasked: promptTurn?.contentMasked ?? null,
      responseTextMasked: row.turn.contentMasked,
      mergePolicyApplied: row.mergePolicyApplied,
      groundingConfidence:
        row.groundingConfidence === null ? null : Number(row.groundingConfidence),
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
      // `BigInt` -> `number`, matching `PrismaRouterConfigRepository`'s identical, documented
      // conversion for the same reason (a per-turn micro-AED cost is nowhere near unsafe range).
      totalCostMicroAed: Number(row.totalCostMicroAed),
      escapeTriggered: row.escapeTriggered,
      steps,
      citations,
    };
  }
}
