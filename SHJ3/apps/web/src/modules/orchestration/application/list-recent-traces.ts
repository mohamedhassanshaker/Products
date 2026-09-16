import type {
  OrchestrationTraceRepository,
  OrchestrationTraceSummaryRow,
} from "../ports/orchestration-trace-repository.js";

/** A real, named bound rather than an unbounded scan — the same discipline
 *  `analytics/application/list-conversations.ts`'s `CONVERSATION_LIST_LIMIT` already
 *  establishes for this screen's closest sibling listing. */
export const RECENT_TRACE_LIMIT = 50;

/** The Orchestrator screen's trace picker — the most recent real turns this tenant has
 *  actually processed, newest first. */
export class ListRecentTraces {
  constructor(private readonly deps: { readonly traces: OrchestrationTraceRepository }) {}

  async execute(): Promise<readonly OrchestrationTraceSummaryRow[]> {
    return this.deps.traces.listRecent(RECENT_TRACE_LIMIT);
  }
}
