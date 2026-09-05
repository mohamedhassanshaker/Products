import type { GraphNode, Reasoning } from '@liveavatar/contracts';

/**
 * Foreground critical-path computation (Phase 10, BL-040 —
 * `docs/v2/ARCHITECTURE_NOTES.md` §3.3, R-G3/R-G10). Enumerates every path
 * from `reasoning.entry_node_id` to a terminal node (an `end` node, or any
 * node whose own "next node ids" come up empty — R-G1's implicit "speak
 * then end" semantics make a dangling `next_node_id: null` a legitimate
 * terminal too, not just an explicit `end` node), summing each path's
 * **foreground-lane** node costs only (R-G14 excludes background-lane
 * nodes from the critical path — see `NODE_COST_STRATEGIES`'s per-node
 * `cost` below).
 *
 * **Extensibility (the actual point of this file's shape)**: every node
 * type's cost and "what nodes can this lead to" is a small strategy object
 * in `NODE_COST_STRATEGIES`, not a hardcoded switch spread through the
 * enumeration algorithm itself. Phase 11 (Parallel/Loop, BL-042/043) adds
 * two more entries to that table — a `parallel` strategy whose cost is the
 * join-policy-aware branch cost (§A3.7: "turn cost = slowest branch, not
 * the sum" for `join: all`) and a `loop` strategy bounded by its own
 * guards — without touching `enumeratePaths`/`computeCriticalPath` at all.
 * Unlike Router, a Parallel/Loop node's branches/body are **internal** (per
 * the schema's chosen representation — see `reasoning-graph.schema.ts`'s
 * doc comment): they contribute a single scalar cost to whatever path
 * reaches this node, and the walk continues via one `next_node_id`, never
 * fanning the *outer* enumeration the way Router's branches do.
 *
 * **Latency estimates are code constants, not a schema field** — see the
 * plan doc's "Node latency-estimate defaults" decision. Nothing in Phase
 * 8/9's schema carries a real per-node latency figure (`ToolNode.timeout_ms`
 * is a worst-case failure bound, not a typical-latency estimate), and
 * §A3.7's wireframe labels these numbers `est. ms` — computed defaults, not
 * admin-typed values.
 */

/** Sane default per-node-type latency estimate (ms) — see the plan doc's reasoning for each figure. */
const DEFAULT_COST_MS: Record<GraphNode['type'], number> = {
  llm: 900,
  tool: 400,
  // Phase 12b: real retrieval now has a real cost — see `NODE_COST_STRATEGIES.retrieve` below,
  // which reads `node.budget_ms` directly. This entry only exists so the `Record` stays total; never read.
  retrieve: 0,
  router: 150,
  speak: 0, // TTS time-to-first-audio is a separate budget share per §A4.1 — not double-counted here
  end: 0,
  // Parallel/Loop's real cost is computed dynamically (see `parallelCost`/
  // `loopCost` below) — these two entries exist only so this `Record`'s
  // type (`Record<GraphNode['type'], number>`) stays total; never read.
  parallel: 0,
  loop: 0,
  // Phase 13 (BL-049/050/051): a Skill node reads `node.budget_ms` directly
  // (see `NODE_COST_STRATEGIES.skill` below), the same "real worst-case
  // bound, not a code-constant estimate" treatment `retrieve` already gets
  // — this entry only exists so the `Record` stays total; never read.
  skill: 0,
  // Phase 14 (BL-052/053, R-H4): a HITL node has no numeric cost at all —
  // see `NODE_COST_STRATEGIES.hitl` below and `isUnboundedNode()`. This
  // entry only exists so the `Record` stays total; never read.
  hitl: 0,
  // Phase 15 (BL-058): a Sub-agent node reads `node.budget_ms` directly
  // (see `NODE_COST_STRATEGIES.subagent` below) — same "real worst-case
  // bound, not a code-constant estimate" treatment `retrieve`/`skill`
  // already get — this entry only exists so the `Record` stays total.
  subagent: 0,
  // Phase 15 (BL-059): terminal, like `end` — no continuation to cost.
  handoff: 0,
  // Phase 15 (BL-060): an in-memory read/write is effectively free —
  // negligible compared to any LLM/tool/retrieval hop on the same path.
  state: 0,
};

/** One node type's contribution to critical-path enumeration — cost, and which node ids the foreground walk can continue to. */
interface NodeCostStrategy<N extends GraphNode = GraphNode> {
  /**
   * @param nodesById - The whole graph, keyed by id. Only `parallel`/`loop`
   *   need it (to recurse into a branch/body chain via `maxChainCost`) —
   *   every other node type's `cost()` ignores this parameter.
   */
  cost(node: N, nodesById: ReadonlyMap<string, GraphNode>): number;
  nextNodeIds(node: N): string[];
}

function terminalNextIds(): string[] {
  return [];
}

/** Shared `nextNodeIds` for every node type whose next hop is a single, optional `next_node_id` field. */
function singleNextId(node: { next_node_id: string | null }): string[] {
  return node.next_node_id ? [node.next_node_id] : terminalNextIds();
}

// Defensive bound against a pathological/cyclic chain — mirrors
// `MAX_PATH_DEPTH` below. In practice `computeCriticalPath` only ever runs
// after Gate A (including the Phase 11 V-4 cycle check) has passed, so this
// never actually triggers on a valid config; pure belt-and-suspenders, same
// spirit as this file's other defensive bounds.
const MAX_CHAIN_DEPTH = 200;

/**
 * The worst-case (max) cost of a single bounded chain starting at `startId`
 * — used for a Parallel branch or a Loop body pass, both of which are
 * "internal" chains per this schema's chosen representation (see the module
 * docstring). Walks via each node type's own `nextNodeIds`, taking the
 * `Math.max` over any Router-style fan-out encountered along the way (a
 * branch/body may itself contain a nested Router with several possible
 * continuations) — mutually recursive with `costFor`, so a nested
 * Parallel/Loop inside a branch/body is handled the exact same way a
 * top-level one is.
 */
function maxChainCost(startId: string, nodesById: ReadonlyMap<string, GraphNode>, visited: ReadonlySet<string>, depth: number): number {
  if (depth >= MAX_CHAIN_DEPTH || visited.has(startId)) {
    return 0;
  }
  const node = nodesById.get(startId);
  if (!node) {
    return 0;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(startId);
  const own = costFor(node, nodesById);
  const nexts = nextIdsFor(node);
  if (nexts.length === 0) {
    return own;
  }
  const rest = Math.max(...nexts.map((id) => maxChainCost(id, nodesById, nextVisited, depth + 1)));
  return own + rest;
}

/**
 * Parallel node cost — a documented judgement call per branch, since the
 * true worst case depends on completion order, which isn't knowable at
 * design time:
 * - `all`/`all_settled` -> the **slowest** branch (verbatim match for
 *   §A3.7's "Turn cost = slowest branch (410ms), not the sum").
 * - `first_success` -> the **fastest** branch — an optimistic estimate,
 *   since the whole point of this policy is finishing as soon as any branch
 *   succeeds.
 * - `quorum(n)` -> the **n-th fastest** branch (branch costs sorted
 *   ascending, index `n-1`) — the natural generalization of
 *   `first_success`'s logic to "the n-th one to finish, in estimated order."
 */
function parallelCost(node: Extract<GraphNode, { type: 'parallel' }>, nodesById: ReadonlyMap<string, GraphNode>): number {
  const branchCosts = node.branches.map((b) => maxChainCost(b.entry_node_id, nodesById, new Set(), 0));
  if (branchCosts.length === 0) {
    return 0;
  }
  switch (node.join_policy) {
    case 'all':
    case 'all_settled':
      return Math.max(...branchCosts);
    case 'first_success':
      return Math.min(...branchCosts);
    case 'quorum': {
      const sorted = [...branchCosts].sort((a, b) => a - b);
      const n = Math.min(Math.max(node.quorum_n ?? 1, 1), sorted.length);
      return sorted[n - 1];
    }
  }
}

/**
 * Loop node cost — bounded by whichever of `max_duration_ms` or
 * (per-iteration body cost × `max_iterations`) is tighter: a loop whose
 * duration guard would time-box it well before it could ever run
 * `max_iterations` full passes shouldn't be charged the larger, unreachable
 * number.
 */
function loopCost(node: Extract<GraphNode, { type: 'loop' }>, nodesById: ReadonlyMap<string, GraphNode>): number {
  const bodyCost = maxChainCost(node.body_entry_node_id, nodesById, new Set(), 0);
  return Math.min(node.max_duration_ms, bodyCost * node.max_iterations);
}

const NODE_COST_STRATEGIES: { [T in GraphNode['type']]: NodeCostStrategy<Extract<GraphNode, { type: T }>> } = {
  llm: {
    cost: () => DEFAULT_COST_MS.llm,
    nextNodeIds: singleNextId,
  },
  tool: {
    cost: () => DEFAULT_COST_MS.tool,
    nextNodeIds: singleNextId,
  },
  retrieve: {
    // Phase 12b (BL-045/047) — `budget_ms` is a genuine worst-case bound
    // (R-R3: retrieval never blocks past its own budget, it returns
    // whatever's been retrieved so far), the same category as
    // `ToolNodeSchema.timeout_ms`'s existing "worst-case failure bound, not
    // typical latency" precedent this file's own docstring already
    // establishes — so, unlike every other node type here, this one reads a
    // real schema field instead of a code constant.
    cost: (node) => node.budget_ms,
    nextNodeIds: singleNextId,
  },
  speak: {
    cost: () => DEFAULT_COST_MS.speak,
    nextNodeIds: singleNextId,
  },
  router: {
    cost: () => DEFAULT_COST_MS.router,
    // Every branch fans out into its own path (this is where the "all
    // paths" enumeration actually branches) plus the mandatory default.
    nextNodeIds: (node) => [...node.branches.map((b) => b.next_node_id), node.default_next_node_id],
  },
  end: {
    cost: () => DEFAULT_COST_MS.end,
    nextNodeIds: terminalNextIds,
  },
  parallel: {
    cost: parallelCost,
    // Branches are internal (see the module docstring) — the outer
    // enumeration only ever continues via this node's own `next_node_id`.
    nextNodeIds: singleNextId,
  },
  loop: {
    cost: loopCost,
    // The body is internal — the outer enumeration only ever continues via
    // this node's own `next_node_id`.
    nextNodeIds: singleNextId,
  },
  skill: {
    // Phase 13 (BL-049/050/051) — `budget_ms` is this node's own declared
    // worst-case latency budget (R-S5), the same category as
    // `RetrieveNodeSchema.budget_ms`'s precedent this file's docstring
    // already documents: real per-node data, not a code-constant estimate.
    cost: (node) => node.budget_ms,
    nextNodeIds: singleNextId,
  },
  hitl: {
    // R-H4: "the builder marks the path as unbounded rather than pretending
    // to estimate it" — a blocking gate's wait is bounded only by its SLA
    // (up to the gate's own `slaSeconds`, itself up to an hour), which this
    // file cannot resolve anyway (no DB access to the referenced `HitlGate`
    // row, nor to its `gateType` — the same "resolved once at session-start
    // read time" boundary `SkillNodeSchema`'s doc comment already
    // establishes for skills). Contributes zero numeric cost; `isUnboundedNode`
    // below is what actually flags the containing path/report instead.
    cost: () => 0,
    nextNodeIds: singleNextId,
  },
  subagent: {
    // Phase 15 (BL-058) — `budget_ms` is this node's own declared
    // worst-case latency budget, the same category as
    // `SkillNodeSchema.budget_ms`'s precedent (v1 delegation is one bounded
    // LLM turn against the target tenant's persona, not a nested graph —
    // see the schema's own doc comment).
    cost: (node) => node.budget_ms,
    nextNodeIds: singleNextId,
  },
  handoff: {
    // Terminal, like `end` — nothing left for this turn's graph walk.
    cost: () => DEFAULT_COST_MS.handoff,
    nextNodeIds: terminalNextIds,
  },
  state: {
    cost: () => DEFAULT_COST_MS.state,
    nextNodeIds: singleNextId,
  },
};

/** R-H4 — every HITL node makes any path through it unbounded, regardless of the (unresolvable here) gate type. */
function isUnboundedNode(node: GraphNode): boolean {
  return node.type === 'hitl';
}

function costFor(node: GraphNode, nodesById: ReadonlyMap<string, GraphNode>): number {
  const strategy = NODE_COST_STRATEGIES[node.type] as NodeCostStrategy<GraphNode>;
  // R-G14 — background-lane nodes never count against the critical path,
  // regardless of node type. This is a defensive exclusion: Phase 9's Gate A
  // structural check doesn't (yet) forbid a foreground edge from pointing at
  // a `lane: background` node, so this function stays correct even for that
  // anomalous, not-otherwise-prevented shape.
  return node.lane === 'background' ? 0 : strategy.cost(node, nodesById);
}

function nextIdsFor(node: GraphNode): string[] {
  const strategy = NODE_COST_STRATEGIES[node.type] as NodeCostStrategy<GraphNode>;
  return strategy.nextNodeIds(node);
}

/** One step on an enumerated path — enough for the builder to render a timeline segment (§A4.3). */
export interface CriticalPathStep {
  node_id: string;
  node_type: string;
  name: string;
  lane: 'foreground' | 'background';
  cost_ms: number;
  /** R-H4 — true only for a `hitl` step; see `isUnboundedNode`. */
  unbounded?: boolean;
}

/**
 * One fully-enumerated path from the entry node to a terminal node.
 * `unbounded: true` (R-H4, any step is a HITL node) means `total_ms`/
 * `over_budget` are informational only (they sum the *known* costs, treating
 * the HITL node as free) — not a real worst-case bound, so `over_budget` is
 * forced `false` rather than risk a false "within budget" *or* false "over
 * budget" reading from a number that was never real.
 */
export interface CriticalPathGraphPath {
  steps: CriticalPathStep[];
  total_ms: number;
  over_budget: boolean;
  unbounded: boolean;
}

/** Full critical-path report — the "all paths" list plus the single longest (critical) one. */
export interface CriticalPathReport {
  critical_path_ms: number;
  turn_budget_ms: number;
  over_budget: boolean;
  /** R-H4 — true when at least one enumerated path passes through a HITL node. `critical_path_ms`/`over_budget` are computed over the *bounded* paths only. */
  has_unbounded_path: boolean;
  paths: CriticalPathGraphPath[];
}

// Defensive bounds against a Router branch cycle — V-4 (real cycle
// detection) is Phase 11, no `Loop` node exists yet to legitimize any cycle
// at all (same documented gap `graph-structure.ts` already flags). Without
// these, an adversarial or corrupted graph could make enumeration loop
// forever instead of just producing an (intentionally incomplete, but
// bounded) report.
const MAX_PATH_DEPTH = 200;
const MAX_PATHS = 500;

/**
 * Enumerates every path from `entryNodeId` to a terminal node. A node
 * already present earlier on the current path is treated as a cycle and
 * that branch is abandoned (not followed further) rather than looping
 * forever — see the module docstring's cycle-guard note.
 */
function enumeratePaths(reasoning: Reasoning): CriticalPathGraphPath[] {
  const nodesById = new Map(reasoning.graph.map((n) => [n.id, n]));
  const paths: CriticalPathGraphPath[] = [];

  function walk(nodeId: string, stepsSoFar: CriticalPathStep[], visited: ReadonlySet<string>): void {
    if (paths.length >= MAX_PATHS || stepsSoFar.length >= MAX_PATH_DEPTH) {
      return;
    }
    const node = nodesById.get(nodeId);
    if (!node || visited.has(nodeId)) {
      // Dangling ref (Gate A structural checks report this separately) or a
      // cycle — either way, this branch cannot be extended into a valid
      // terminal path, so it's dropped rather than fabricated.
      return;
    }

    const step: CriticalPathStep = {
      node_id: node.id,
      node_type: node.type,
      name: node.name,
      lane: node.lane,
      cost_ms: costFor(node, nodesById),
      ...(isUnboundedNode(node) ? { unbounded: true } : {}),
    };
    const steps = [...stepsSoFar, step];
    const nextIds = nextIdsFor(node);

    if (nextIds.length === 0) {
      const total_ms = steps.reduce((sum, s) => sum + s.cost_ms, 0);
      const unbounded = steps.some((s) => s.unbounded === true);
      paths.push({ steps, total_ms, over_budget: unbounded ? false : total_ms > reasoning.turn_budget_ms, unbounded });
      return;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);
    for (const nextId of nextIds) {
      walk(nextId, steps, nextVisited);
    }
  }

  walk(reasoning.entry_node_id, [], new Set());
  return paths;
}

/**
 * Computes the full critical-path report for a `reasoning` block (V-1,
 * R-G3/R-G10). Pure and defensive — never throws on a structurally
 * malformed graph (a dangling `entry_node_id`, an unresolvable `next_node_id`)
 * since Gate A's own structural check (`graph-structure.ts`) reports those
 * separately; this function simply produces whatever paths *do* resolve
 * (possibly zero).
 * @param reasoning - `config.reasoning` (already schema-valid — see the plan
 *   doc's "Decisions made this phase" on why this is only ever called after
 *   Gate A passes)
 */
export function computeCriticalPath(reasoning: Reasoning): CriticalPathReport {
  const paths = enumeratePaths(reasoning);
  const boundedPaths = paths.filter((p) => !p.unbounded);
  const critical_path_ms = boundedPaths.reduce((max, p) => Math.max(max, p.total_ms), 0);
  return {
    critical_path_ms,
    turn_budget_ms: reasoning.turn_budget_ms,
    over_budget: critical_path_ms > reasoning.turn_budget_ms,
    has_unbounded_path: paths.some((p) => p.unbounded),
    paths,
  };
}
