import { messageForCode } from '@liveavatar/contracts';
import type { GraphNode, Reasoning } from '@liveavatar/contracts';
import type { ConfigError } from './errors';

/**
 * V-2 and V-4 (Phase 11, BL-042/BL-043; `docs/v2/ARCHITECTURE_NOTES.md` §7's
 * table lists both as "Gate A structural", living in this new file). Both
 * block **save** (draft or published), not just publish — confirmed by
 * reading `save-config.use-case.ts`: `!gateA.schemaValid` throws a 400
 * before `save_as` is even inspected, which is what makes a Gate A check
 * (this file, `graph-structure.ts`) block every save, while a Gate B/
 * `combination-rules.ts` rule only ever blocks a `published` save.
 *
 * Mirrored in Python's `ReasoningBlock` model validator
 * (`contracts/runtime_config.py`) for the same reason `graph-structure.ts`'s
 * checks are mirrored there: the cross-language contract test runs one
 * fixture corpus through both validators and requires them to agree.
 */

/**
 * R-G4/V-2 — every Loop node must have all three guards present *and
 * positive*: `max_iterations >= 1`, `max_duration_ms >= 1`, `max_cost >= 0`.
 * "Present" is already guaranteed by ordinary TypeBox requiredness (the
 * three fields are non-optional on `LoopNodeSchema` with deliberately
 * unconstrained numeric ranges — see that schema's doc comment); this
 * function's real job is the positivity check, one error per violated
 * guard, each attributed to the specific node + field
 * (`UX_SCOPE.md`: "each attaches to the specific node card").
 */
export function validateLoopGuards(reasoning: Reasoning | undefined): ConfigError[] {
  if (!reasoning?.graph) {
    return [];
  }
  const errors: ConfigError[] = [];
  for (const node of reasoning.graph) {
    if (node.type !== 'loop') {
      continue;
    }
    const guardError = (field: string): ConfigError => ({
      code: 'CONFIG_LOOP_GUARD_INVALID',
      layer: 'reasoning.graph',
      field: `${node.id}/${field}`,
      message: messageForCode('CONFIG_LOOP_GUARD_INVALID'),
    });
    if (!(node.max_iterations >= 1)) {
      errors.push(guardError('max_iterations'));
    }
    if (!(node.max_duration_ms >= 1)) {
      errors.push(guardError('max_duration_ms'));
    }
    if (!(node.max_cost >= 0)) {
      errors.push(guardError('max_cost'));
    }
  }
  return errors;
}

/** Every node type's "next hop" ids for V-4's DFS — mirrors (a subset of) `critical-path.ts`'s `NODE_COST_STRATEGIES.nextNodeIds`, kept independent here since this check has no need for cost. */
function nextHopIds(node: GraphNode): string[] {
  switch (node.type) {
    case 'llm':
    case 'tool':
    case 'retrieve':
    case 'speak':
    case 'skill':
    case 'hitl':
    case 'subagent':
    case 'state':
      return node.next_node_id ? [node.next_node_id] : [];
    case 'handoff':
      return [];
    case 'router':
      return [...node.branches.map((b) => b.next_node_id), node.default_next_node_id];
    case 'parallel':
      return [...node.branches.map((b) => b.entry_node_id), ...(node.next_node_id ? [node.next_node_id] : [])];
    case 'loop':
      return [node.body_entry_node_id, ...(node.next_node_id ? [node.next_node_id] : [])];
    case 'end':
      return [];
  }
}

// Defensive bound against a pathologically large/dangling graph — same
// spirit as `critical-path.ts`'s `MAX_PATH_DEPTH`/`MAX_PATHS`. Gate A's
// referential-integrity check (`graph-structure.ts`) already reports
// dangling refs separately; this DFS just needs to never hang on one.
const MAX_NODES_VISITED = 5000;

/**
 * R-G5/V-4 — no graph cycles, full stop. Under this phase's chosen branch/
 * body representation (single node-id references, repetition expressed as
 * repeated interpreter-level invocation rather than a graph-level
 * back-edge — see the plan doc's Phase 11 section), a validly-authored
 * Parallel branch or Loop body never legitimately contains a cycle at all,
 * so "no cycles outside Loop" and "no cycles, period" collapse into the same
 * DFS. This still delivers R-G5's actual guarantee: an arbitrary back-edge
 * (e.g. a stray Router branch pointing backward) is always rejected.
 *
 * Plain DFS with a recursion (grey-node) stack — a node currently on the
 * stack being revisited is a real cycle; a node already fully explored
 * (black) being reached again via a different path is just a DAG diamond,
 * not a cycle, and must not be flagged.
 */
export function validateNoCycles(reasoning: Reasoning | undefined): ConfigError[] {
  if (!reasoning?.graph) {
    return [];
  }
  const nodesById = new Map(reasoning.graph.map((n) => [n.id, n]));
  const state = new Map<string, 'visiting' | 'done'>();
  let visitedCount = 0;
  let cycleFound = false;
  // The node id the cycle was actually detected at — needed so this error
  // can attach to a specific node card (`reasoning.store.ts`'s
  // `errorsByNode()` derives a card id from `layer === 'reasoning.graph'` +
  // `field`; without a `field` this error would silently attach to
  // *nothing*, since `globalErrors()` also excludes every
  // `layer: 'reasoning.graph'` error unconditionally).
  let cycleAtNodeId: string | undefined;

  function visit(nodeId: string): void {
    if (cycleFound || visitedCount >= MAX_NODES_VISITED) {
      return;
    }
    const current = state.get(nodeId);
    if (current === 'visiting') {
      cycleFound = true;
      cycleAtNodeId = nodeId;
      return;
    }
    if (current === 'done') {
      return;
    }
    const node = nodesById.get(nodeId);
    if (!node) {
      // Dangling ref — reported separately by `graph-structure.ts`.
      return;
    }
    visitedCount++;
    state.set(nodeId, 'visiting');
    for (const next of nextHopIds(node)) {
      visit(next);
      if (cycleFound) {
        break;
      }
    }
    state.set(nodeId, 'done');
  }

  // Every node is a potential DFS root, not just `entry_node_id`/
  // `background_entry_node_ids` — a cycle reachable only from inside an
  // otherwise-unreached branch/body must still be caught.
  for (const node of reasoning.graph) {
    visit(node.id);
    if (cycleFound) {
      break;
    }
  }

  if (!cycleFound) {
    return [];
  }
  return [
    {
      code: 'CONFIG_GRAPH_CYCLE_DETECTED',
      layer: 'reasoning.graph',
      field: cycleAtNodeId,
      message: messageForCode('CONFIG_GRAPH_CYCLE_DETECTED'),
    },
  ];
}

/**
 * V-10 (Phase 12b, BL-045/047; `ARCHITECTURE_NOTES.md` §7 — "Gate A
 * structural (pure arithmetic)") — every `retrieve`-type node's own
 * `budget_ms` must be enough to cover the tenant's `knowledge.pipeline`'s
 * summed per-stage `budget_ms` fields (rewrite + hybrid_search +
 * metadata_filter + threshold + inject — rerank is excluded, it has no
 * `budget_ms` at all since it's a deferred, never-invoked no-op this
 * phase). Every `retrieve` node inherits the same tenant-wide pipeline (see
 * `reasoning-graph.schema.ts`'s `RetrieveNodeSchema` doc comment), so this
 * one sum is checked against every such node's own budget independently —
 * a node with a tighter `budget_ms` than the pipeline's own stage total
 * fails even though a more generous sibling node might pass.
 */
/** Structurally minimal shape this check needs — deliberately narrower than the full `RetrievalPipelineConfig` (every leaf optional) so a still-in-progress draft's partially-filled pipeline never throws, only ever skips (see below). */
export interface PartialRetrievalPipelineBudgets {
  rewrite?: { budget_ms?: number };
  hybrid_search?: { budget_ms?: number };
  metadata_filter?: { budget_ms?: number };
  threshold?: { budget_ms?: number };
  inject?: { budget_ms?: number };
}

export function validateRetrievalBudgets(
  reasoning: Reasoning | undefined,
  pipeline: PartialRetrievalPipelineBudgets | undefined,
): ConfigError[] {
  const retrieveNodes = (reasoning?.graph ?? []).filter((n): n is Extract<GraphNode, { type: 'retrieve' }> => n.type === 'retrieve');
  if (retrieveNodes.length === 0 || !pipeline) {
    return [];
  }
  const stageBudgets = [
    pipeline.rewrite?.budget_ms,
    pipeline.hybrid_search?.budget_ms,
    pipeline.metadata_filter?.budget_ms,
    pipeline.threshold?.budget_ms,
    pipeline.inject?.budget_ms,
  ];
  // A still-in-progress draft may not have every stage's budget filled in
  // yet — skip rather than compute a misleading sum (Gate B's own
  // completeness checks are what report "this isn't ready to publish" for
  // that case, not this arithmetic check).
  if (!stageBudgets.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) {
    return [];
  }
  const stageSum = stageBudgets.reduce((sum, v) => sum + v, 0);
  const errors: ConfigError[] = [];
  for (const node of retrieveNodes) {
    if (stageSum > node.budget_ms) {
      errors.push({
        code: 'CONFIG_RETRIEVAL_BUDGET_EXCEEDED',
        layer: 'reasoning.graph',
        field: node.id,
        message: `Retrieve node '${node.id}' pipeline stage budgets (${stageSum}ms) exceed its own budget (${node.budget_ms}ms).`,
      });
    }
  }
  return errors;
}

/** Runs the Phase 11/12b Gate A structural checks (V-2, V-4, V-10). */
export function validateGraphRules(
  reasoning: Reasoning | undefined,
  knowledgePipeline?: PartialRetrievalPipelineBudgets,
): ConfigError[] {
  return [...validateLoopGuards(reasoning), ...validateNoCycles(reasoning), ...validateRetrievalBudgets(reasoning, knowledgePipeline)];
}
