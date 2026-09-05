import type { GraphNode, LlmNode } from '@liveavatar/contracts';

/**
 * The node types this phase's schema/UI support (BL-035 — see
 * `reasoning-graph.schema.ts`'s doc comment). Phase 9 shipped the first six
 * (LLM/Tool/Retrieve/Router/Speak/End); Phase 11 (BL-042/043) adds
 * `parallel`/`loop`; Phase 13 adds `skill`; Phase 14 adds `hitl`; Phase 15
 * adds `subagent`/`handoff`/`state`, completing the full 13-type A3.2 set.
 */
export const NODE_TYPES = [
  'llm',
  'tool',
  'retrieve',
  'router',
  'speak',
  'end',
  'parallel',
  'loop',
  'skill',
  'hitl',
  'subagent',
  'handoff',
  'state',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const NODE_TYPE_NAMES: Record<NodeType, string> = {
  llm: 'LLM',
  tool: 'Tool',
  retrieve: 'Retrieve',
  router: 'Router',
  speak: 'Speak',
  end: 'End',
  parallel: 'Parallel',
  loop: 'Loop',
  skill: 'Skill',
  hitl: 'HITL',
  subagent: 'Sub-agent',
  handoff: 'Handoff',
  state: 'State',
};

/**
 * A fresh, unique node id for a newly added node — `type-N`, N being the
 * smallest positive integer not already used by an id with this prefix.
 * Satisfies `NodeId`'s pattern (`^[a-zA-Z0-9_-]+$`).
 * @param existingIds - Every node id already in the graph
 * @param type - New node's type, used as the id prefix for readability
 */
export function generateNodeId(existingIds: Iterable<string>, type: NodeType): string {
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`${type}-${n}`)) {
    n++;
  }
  return `${type}-${n}`;
}

/**
 * A fresh, unique branch id for a newly added Parallel branch —
 * `branch-N`, mirroring `generateNodeId`'s pattern but scoped to one node's
 * *own* branch list rather than the graph-wide node-id namespace (a
 * `ParallelBranch.id` only needs to be unique within its own node — see
 * `reasoning-graph.schema.ts`'s `ParallelBranchSchema`).
 * @param existingIds - Branch ids already present on this Parallel node
 */
export function generateBranchId(existingIds: Iterable<string>): string {
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`branch-${n}`)) {
    n++;
  }
  return `branch-${n}`;
}

/**
 * Builds a new node with sensible, schema-valid defaults for its type
 * (R-G7: `on_error`/`on_deadline` always present). Left deliberately
 * incomplete where a real value can't be guessed (e.g. an LLM node's
 * `provider`/`model`) — the inspector opens immediately after a node is
 * added so the admin fills those in, and Gate B / the debounced validate
 * flow reports what's still missing, the same discipline as every other
 * incomplete-draft field in this app (FR-CONFIG-3).
 *
 * Node array order carries no execution meaning — the graph is walked by
 * `id` reference (`entry_node_id`, `next_node_id`, branch targets), not by
 * array position — so "Add node" always appends; there is no positional
 * insert to get right.
 * @param type - Node type to create
 * @param id - Pre-generated unique id (see `generateNodeId`)
 */
export function createDefaultNode(type: NodeType, id: string): GraphNode {
  const base = {
    id,
    name: `${NODE_TYPE_NAMES[type]} node`,
    lane: 'foreground' as const,
    on_error: { action: 'degrade' as const },
    on_deadline: { action: 'degrade' as const },
  };
  switch (type) {
    case 'llm':
      return {
        ...base,
        type: 'llm',
        provider: 'openai',
        model: '',
        retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
        next_node_id: null,
      };
    case 'tool':
      return { ...base, type: 'tool', api_ref: '', argument_mapping: {}, next_node_id: null };
    case 'retrieve':
      // `budget_ms: 400` mirrors `RetrieveNodeSchema.budget_ms`'s own schema
      // default (Phase 12b, BL-045/047) — the node's own overall retrieval
      // ceiling, editable in the inspector like every other field here.
      return { ...base, type: 'retrieve', source_refs: [], top_k: 5, budget_ms: 400, next_node_id: null };
    case 'router':
      // A brand-new Router has no other node to branch to yet; defaulting
      // to itself keeps the schema's non-optional `default_next_node_id`
      // satisfied (a known id) until the admin points it somewhere real via
      // the inspector — flagged there, not silently wrong.
      return { ...base, type: 'router', branches: [], default_next_node_id: id };
    case 'speak':
      return { ...base, type: 'speak', mode: 'llm_output', interruptible: true, next_node_id: null };
    case 'end':
      return { ...base, type: 'end' };
    case 'parallel':
      // An empty `branches: []` fails the schema's `minItems: 1`, same
      // situation as Router's brand-new `branches: []` above — the
      // inspector's `canSave()` requires at least one real branch before
      // Apply is enabled, so this is flagged there, not silently wrong.
      return { ...base, type: 'parallel', branches: [], join_policy: 'all', on_branch_error: 'continue_partial', next_node_id: null };
    case 'loop':
      // Same self-referential-placeholder philosophy as Router's
      // `default_next_node_id: id` above: `body_entry_node_id` needs *a*
      // known id to satisfy the schema until the admin points it at a real
      // node via the inspector.
      return {
        ...base,
        type: 'loop',
        body_entry_node_id: id,
        condition: '',
        max_iterations: 3,
        max_duration_ms: 10000,
        max_cost: 30,
        next_node_id: null,
      };
    case 'skill':
      // Phase 13 (BL-049/050/051) — `budget_ms: 1500` mirrors
      // `SkillNodeSchema.budget_ms`'s own schema default; `skill_id` is
      // left blank (no default skill exists) so the inspector's
      // `canSave()` requires a real selection before Apply is enabled,
      // same "flagged there, not silently wrong" philosophy as Router's
      // empty `branches: []` above.
      return { ...base, type: 'skill', skill_id: '', version: 'latest', budget_ms: 1500, next_node_id: null };
    case 'hitl':
      // Phase 14 (BL-052/053) — `gate_id` is left blank (no default gate
      // exists) so the inspector's `canSave()` requires a real selection
      // before Apply is enabled, same "flagged there, not silently wrong"
      // philosophy as Skill's blank `skill_id` above. Deliberately no
      // `budget_ms` field at all — R-H4 marks any path through a blocking
      // gate as *unbounded*, mirrored by `HitlNodeSchema` itself carrying
      // no cost field (see that schema's own doc comment).
      return { ...base, type: 'hitl', gate_id: '', next_node_id: null };
    case 'subagent':
      // Phase 15 (BL-058) — `target_tenant_id` is left blank (no default
      // delegation target exists) so the inspector's `canSave()` requires a
      // real tenant pick before Apply is enabled, same "flagged there, not
      // silently wrong" philosophy as Skill's blank `skill_id`/HITL's blank
      // `gate_id` above. `budget_ms: 4000` mirrors `SubAgentNodeSchema`'s own
      // schema default.
      return { ...base, type: 'subagent', target_tenant_id: '', handback_policy: 'speak_and_return', budget_ms: 4000, next_node_id: null };
    case 'handoff':
      // Phase 15 (BL-059) — no `next_node_id` at all: terminal, exactly like
      // the `end` node type above (see `HandoffNodeSchema`'s doc comment).
      return { ...base, type: 'handoff', destination: '', context_summary: '' };
    case 'state':
      // Phase 15 (BL-060) — defaults to `mode: 'write'` (the more common
      // case — Speak/Tool nodes downstream typically want to capture
      // something new into session state) with both `variable`/`value`
      // blank so `canSave()` requires the admin to fill in a real variable
      // name (and, since `write` needs it, a value) before Apply is
      // enabled.
      return { ...base, type: 'state', mode: 'write', variable: '', value: '', next_node_id: null };
  }
}

/**
 * The default single-LLM-node graph a fresh/minimal agent gets (R-G1),
 * mirroring `apps/api/.../domain/agent-config.ts`'s `buildSingleLlmNodeGraph`
 * exactly (same node id, name, edges, retry policy) so a config built here
 * round-trips identically through Gate A/B. Used only by the Reasoning tab's
 * empty state ("Set up the reasoning graph") when `config.reasoning` is
 * entirely absent — never invoked automatically, since the choice of LLM
 * provider is the admin's to make.
 * @param leg - Primary LLM provider/model the admin just picked in the empty-state form
 */
export function buildSingleLlmNodeGraph(leg: { provider: string; credential_ref?: string; model: string }): {
  graph: GraphNode[];
  entry_node_id: string;
  background_entry_node_ids: string[];
  turn_budget_ms: number;
} {
  return {
    entry_node_id: 'llm-1',
    background_entry_node_ids: [],
    turn_budget_ms: 3000,
    graph: [
      {
        id: 'llm-1',
        type: 'llm',
        name: 'Answer',
        lane: 'foreground',
        on_error: { action: 'degrade' },
        on_deadline: { action: 'degrade' },
        // `leg.provider` comes from a `mat-select` populated with the live
        // LLM provider catalog (see `reasoning-page.component.html`'s empty
        // state), so it is always a valid key at runtime even though its
        // static type here is the same loose `string` every other
        // provider-picker field in this app uses (`AgentConfigDraft`'s
        // `stt`/`tts`/`avatar` fields) rather than the strict catalog union.
        provider: leg.provider as LlmNode['provider'],
        credential_ref: leg.credential_ref,
        model: leg.model,
        retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
        next_node_id: null,
      },
    ],
  };
}
