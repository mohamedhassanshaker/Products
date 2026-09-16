import type {
  OrchestrationTraceDetail,
  OrchestrationTraceRepository,
} from "../ports/orchestration-trace-repository.js";

export class TraceNotFoundError extends Error {
  readonly code = "orchestration.trace_not_found";
  constructor() {
    super("No orchestration trace with this id.");
    this.name = "TraceNotFoundError";
  }
}

/** The Orchestrator screen's trace detail — the real router decision, the real ordered
 *  per-step trace (guardrails, routing, agent invokes, tool calls, merge), and the real
 *  merge/grounding outcome for one real turn, selected from `ListRecentTraces`'s picker. */
export class GetTraceDetail {
  constructor(private readonly deps: { readonly traces: OrchestrationTraceRepository }) {}

  async execute(traceId: string): Promise<OrchestrationTraceDetail> {
    const detail = await this.deps.traces.getDetail(traceId);
    if (detail === null) throw new TraceNotFoundError();
    return detail;
  }
}
