import type { DelegationTreeNode, DelegationOutcomeValue } from "@nextbot/contracts";

/** Pure, I/O-free (LLD §2.2) — the flat-list-to-tree assembly LLD §14.7.2 calls
 * "one indexed scan renders the whole tree": the repository does the one indexed
 * scan (ordered by `depth, sibling_ordinal`), this function does the assembly. */
export interface FlatDelegationEvent {
  id: string;
  parentDelegationEventId: string | null;
  depth: number;
  siblingOrdinal: number;
  agentLabel: string;
  memberKey: string | null;
  reason: string;
  outcome: DelegationOutcomeValue;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number | null;
  spanId: string;
  toolCallIds: string[];
}

/**
 * Assembles a flat, depth/sibling-ordered `delegation_event` row list into the
 * recursive `DelegationTreeNode[]` shape (LLD §14.7.5). A row with a
 * `parentDelegationEventId` that never appears in `events` (a truncated/partial
 * fetch, or a still-in-flight run whose parent hasn't been written yet) is
 * treated as its own root rather than silently dropped — losing a node from the
 * rendered tree would misrepresent what actually happened, which is worse than
 * showing it detached from its real parent.
 */
export function buildDelegationTree(events: FlatDelegationEvent[]): DelegationTreeNode[] {
  const nodeById = new Map<string, DelegationTreeNode>();
  for (const event of events) {
    nodeById.set(event.id, {
      delegationEventId: event.id,
      depth: event.depth,
      agentLabel: event.agentLabel,
      memberKey: event.memberKey,
      reason: event.reason,
      outcome: event.outcome,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costUsd: event.costUsd,
      latencyMs: event.latencyMs,
      spanId: event.spanId,
      toolCallIds: event.toolCallIds,
      children: [],
    });
  }

  const roots: DelegationTreeNode[] = [];
  for (const event of events) {
    const node = nodeById.get(event.id)!;
    const parent = event.parentDelegationEventId ? nodeById.get(event.parentDelegationEventId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
