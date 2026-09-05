import { messageForCode } from '@liveavatar/contracts';
import type { GraphNode, Reasoning } from '@liveavatar/contracts';
import type { ConfigError } from './errors';

/**
 * Gate A structural (referential-integrity) checks on `reasoning.graph`
 * (Phase 9, BL-035). This is the minimum needed for the graph to be
 * *executable at all* — every node id unique, `entry_node_id` and every
 * `next_node_id`/branch target/`background_entry_node_ids` entry/`on_error`
 * `goto` target resolves to a real node in the same graph.
 *
 * **Not** V-2 (loop guards) or V-4 (cycle detection) — those need a `Loop`
 * node type that doesn't exist until Phase 11 and stay Gate A structural
 * checks living in a future `graph-rules.ts` per
 * `docs/v2/ARCHITECTURE_NOTES.md` §7's table. A Router branch that points
 * backward today (no `Loop` node to legitimize a cycle) is a real,
 * documented gap this phase does not close — flagged in the Phase 9 plan
 * section, not silently accepted.
 * @param reasoning - `config.reasoning`, possibly absent (brand-new tenant, Gate B's completenessRule reports that separately)
 */
export function validateGraphStructure(reasoning: Reasoning | undefined): ConfigError[] {
  if (!reasoning?.graph) {
    return [];
  }
  const errors: ConfigError[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const node of reasoning.graph) {
    if (seen.has(node.id)) {
      errors.push({
        code: 'CONFIG_GRAPH_NODE_ID_DUPLICATE',
        layer: 'reasoning.graph',
        field: node.id,
        message: messageForCode('CONFIG_GRAPH_NODE_ID_DUPLICATE'),
      });
    }
    seen.add(node.id);
    ids.add(node.id);
  }

  const checkRef = (ref: string | null | undefined, field: string): void => {
    if (ref && !ids.has(ref)) {
      errors.push({
        code: 'CONFIG_GRAPH_REF_UNKNOWN',
        layer: 'reasoning.graph',
        field,
        message: messageForCode('CONFIG_GRAPH_REF_UNKNOWN'),
      });
    }
  };

  if (!ids.has(reasoning.entry_node_id)) {
    errors.push({
      code: 'CONFIG_GRAPH_ENTRY_UNKNOWN',
      layer: 'reasoning.entry_node_id',
      field: reasoning.entry_node_id,
      message: messageForCode('CONFIG_GRAPH_ENTRY_UNKNOWN'),
    });
  }
  for (const bgId of reasoning.background_entry_node_ids ?? []) {
    checkRef(bgId, `background_entry_node_ids/${bgId}`);
  }

  for (const node of reasoning.graph) {
    checkRef(node.on_error.target_node_id, `${node.id}/on_error`);
    checkRef(node.on_deadline.target_node_id, `${node.id}/on_deadline`);
    checkNodeRefs(node, checkRef);
  }

  checkQuorumN(reasoning, errors);
  checkStateValue(reasoning, errors);

  return errors;
}

function checkNodeRefs(node: GraphNode, checkRef: (ref: string | null | undefined, field: string) => void): void {
  switch (node.type) {
    case 'llm':
    case 'tool':
    case 'retrieve':
    case 'speak':
    case 'skill':
    case 'hitl':
    case 'subagent':
    case 'state':
      checkRef(node.next_node_id, `${node.id}/next_node_id`);
      return;
    case 'handoff':
      // Terminal, like `end` — no `next_node_id` to check (see
      // `HandoffNodeSchema`'s doc comment).
      return;
    case 'router':
      for (const branch of node.branches) {
        checkRef(branch.next_node_id, `${node.id}/branches`);
      }
      checkRef(node.default_next_node_id, `${node.id}/default_next_node_id`);
      return;
    case 'parallel':
      for (const branch of node.branches) {
        checkRef(branch.entry_node_id, `${node.id}/branches/${branch.id}`);
      }
      checkRef(node.next_node_id, `${node.id}/next_node_id`);
      return;
    case 'loop':
      checkRef(node.body_entry_node_id, `${node.id}/body_entry_node_id`);
      checkRef(node.next_node_id, `${node.id}/next_node_id`);
      return;
    case 'end':
      return;
  }
}

/**
 * Phase 11 (BL-042) — `quorum_n` is required, and must be between 1 and the
 * branch count, only when `join_policy === 'quorum'`. A structural (not
 * schema-shape) check, mirroring the pre-existing Speak-node-`text`
 * precedent ("required only in `literal` mode, checked by the validator, not
 * the schema") — see `reasoning-graph.schema.ts`'s `ParallelNodeSchema` doc
 * comment.
 */
/**
 * Phase 15 (BL-060) — a `state`-type node's `value` is required only when
 * `mode === 'write'`. Same "structural, not schema-shape, checked only in
 * one mode" precedent `checkQuorumN` already establishes below — see
 * `reasoning-graph.schema.ts`'s `StateNodeSchema` doc comment.
 */
function checkStateValue(reasoning: Reasoning, errors: ConfigError[]): void {
  for (const node of reasoning.graph) {
    if (node.type !== 'state' || node.mode !== 'write') {
      continue;
    }
    if (!node.value?.trim()) {
      errors.push({
        code: 'CONFIG_STATE_VALUE_REQUIRED',
        layer: 'reasoning.graph',
        field: `${node.id}/value`,
        message: `State node '${node.id}' must set a value when mode is 'write'.`,
      });
    }
  }
}

function checkQuorumN(reasoning: Reasoning, errors: ConfigError[]): void {
  for (const node of reasoning.graph) {
    if (node.type !== 'parallel' || node.join_policy !== 'quorum') {
      continue;
    }
    const n = node.quorum_n;
    if (n === undefined || n < 1 || n > node.branches.length) {
      errors.push({
        code: 'CONFIG_GRAPH_QUORUM_N_INVALID',
        layer: 'reasoning.graph',
        field: `${node.id}/quorum_n`,
        message: messageForCode('CONFIG_GRAPH_QUORUM_N_INVALID'),
      });
    }
  }
}
