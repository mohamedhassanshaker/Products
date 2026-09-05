import type { GraphNode } from '@liveavatar/contracts';

/**
 * Shared `on_error` edge resolution (Phase 10 fix for Phase 9 finding #2 —
 * see the plan doc). `test-call-graph.use-case.ts`'s Tool/Router recognized-
 * failure paths (unknown `api_ref`, a real tool call failing, a malformed
 * Router condition) must resolve this edge exactly like they would if the
 * failure had instead been a genuinely uncaught exception, never silently
 * proceed via the node's normal `next_node_id`/`default_next_node_id` as if
 * nothing happened.
 *
 * Mirrored, not shared, in Python (`avatar_agent/orchestration/graph/edges.py`)
 * for the real interpreter — same duplication precedent this package's
 * condition grammar already set (see the plan doc's "Decisions made this
 * phase" for Phase 9).
 * @param node - The node whose `on_error` edge should be resolved
 */
export function resolveOnError(node: GraphNode): string | null {
  const edge = node.on_error;
  if (edge.action !== 'goto' || !edge.target_node_id) {
    return null;
  }
  return edge.target_node_id;
}
