import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { ConfigErrorDto, GraphNode, JoinPolicy, TestCallNodeResultDto } from '@liveavatar/contracts';
import { nodeTypeIcon, nodeTypeLabel } from '@liveavatar/web-shared';

/**
 * One node card in the Reasoning tab's node list (Phase 9,
 * `docs/v2/UX_SCOPE.md` "Reasoning tab"). Dumb/presentational — the page
 * owns the graph and opens the inspector; this component only renders and
 * emits intent. `role="listitem"` (its parent list renders `role="list"`);
 * a Router node additionally renders its branches as a nested `role="list"`
 * per the accessibility requirement ("proper nested-list markup, not visual
 * indentation alone"). Phase 11 (BL-042/043) extends this the same way for
 * Parallel (its branches) and Loop (a short walked preview of its body
 * chain, following each node's own `next_node_id` — see `loopBodyPreview`).
 */
@Component({
  selector: 'la-node-card',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './node-card.component.html',
  styleUrl: './node-card.component.scss',
})
export class NodeCardComponent {
  @Input({ required: true }) node!: GraphNode;
  /** Every node in the graph, used to resolve id -> name for `next_node_id`/branch target labels. */
  @Input({ required: true }) allNodes: GraphNode[] = [];
  @Input() errors: ConfigErrorDto[] = [];
  /** This node's outcome from the most recent test call, if any has run (UX_SCOPE.md "per-node last-test-status badge"). */
  @Input() testResult: TestCallNodeResultDto | undefined;
  @Input() isEntry = false;

  @Output() readonly editNode = new EventEmitter<void>();
  @Output() readonly deleteNode = new EventEmitter<void>();
  /** Emitted with a target node id when a branch/next-node reference is activated, so the page can jump the inspector there. */
  @Output() readonly jumpToNode = new EventEmitter<string>();

  readonly icon = () => nodeTypeIcon(this.node.type);
  readonly typeLabel = () => nodeTypeLabel(this.node.type);

  nameFor(nodeId: string | null | undefined): string {
    if (!nodeId) {
      return '';
    }
    return this.allNodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  }

  /** `next_node_id`, for the node types that carry one (Router has none — it only has branches). */
  nextNodeId(): string | null | undefined {
    switch (this.node.type) {
      case 'llm':
      case 'tool':
      case 'retrieve':
      case 'speak':
      case 'parallel':
      case 'loop':
      case 'skill':
      case 'hitl':
      case 'subagent':
      case 'state':
        return this.node.next_node_id;
      default:
        // Router has only branches; End/Handoff are terminal node types
        // with no next_node_id field at all.
        return undefined;
    }
  }

  /** Friendly label for a Parallel node's `join_policy`, shown in the card's meta line. */
  joinPolicyLabel(policy: JoinPolicy): string {
    switch (policy) {
      case 'all':
        return 'all';
      case 'first_success':
        return 'first success';
      case 'quorum':
        return 'quorum';
      case 'all_settled':
        return 'all, partial ok';
    }
  }

  /**
   * Walks a Loop node's body chain, starting at `body_entry_node_id`, by
   * following each node's own `next_node_id` — the same "single reference
   * into the shared flat graph" representation `reasoning-graph.schema.ts`
   * documents for both Parallel branches and Loop bodies. Bounded to 10
   * steps as a defensive display-only guard (mirrors `critical-path.ts`'s
   * `MAX_CHAIN_DEPTH` precedent) — a real cycle is rejected server-side by
   * V-4 before a config could ever reach this render, so the bound is
   * belt-and-suspenders, not load-bearing here.
   */
  loopBodyPreview(node: Extract<GraphNode, { type: 'loop' }>): string[] {
    const maxSteps = 10;
    const names: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = node.body_entry_node_id;
    while (currentId && names.length < maxSteps && !visited.has(currentId)) {
      visited.add(currentId);
      const current = this.allNodes.find((n) => n.id === currentId);
      if (!current) {
        names.push(currentId); // dangling reference — still show something rather than stopping silently
        break;
      }
      names.push(current.name);
      currentId = this.chainNextId(current);
    }
    return names;
  }

  /** The next hop in a walked chain for an arbitrary node (Router/End have none — the walk stops there). */
  private chainNextId(node: GraphNode): string | null {
    switch (node.type) {
      case 'llm':
      case 'tool':
      case 'retrieve':
      case 'speak':
      case 'parallel':
      case 'loop':
      case 'skill':
      case 'hitl':
      case 'subagent':
      case 'state':
        return node.next_node_id;
      default:
        return null;
    }
  }

  testStatusLabel(): 'Not run' | 'Passed' | 'Failed' | 'Skipped' {
    if (!this.testResult) {
      return 'Not run';
    }
    if (this.testResult.status === 'complete') {
      return 'Passed';
    }
    if (this.testResult.status === 'skipped') {
      return 'Skipped';
    }
    return 'Failed';
  }
}
