/**
 * `FlowRepository` — the single port every `modules/flows/application/*` use case depends
 * on. One port, not four (`Flow`/`FlowVersion`/`FlowNode`/`FlowEdge`), matching
 * `agent-bindings-repository.ts`'s own precedent for a small cluster of tables that are
 * always read and written together as one aggregate (a flow's canvas) rather than four
 * independently-evolving entities.
 *
 * Deliberately agent-agnostic: nothing here knows about `Agent`/`AgentVersion`/
 * `AgentFlowBinding` — those are a sibling feature module (`modules/agents/`), and
 * `eslint.config.mjs`'s `boundaries/element-types` forbids this module depending on it.
 * Resolving "which flow does this agent version author against" is therefore an app-layer
 * (`agents/actions.ts`) concern that composes this port with `modules/agents/ports/
 * agent-bindings-repository.ts` — the one sanctioned place structural cross-feature wiring
 * happens (`composition.ts`'s own doc comment).
 */

import type {
  FlowNodeFields,
  FlowNodeType,
  FlowRequiredAssuranceLevel,
} from "../domain/flow-node.js";
import type { FlowEdgeFields } from "../domain/flow-edge.js";

export type FlowVersionStatus = "Draft" | "Published" | "Archived";

export interface FlowVersionRow {
  readonly id: string;
  readonly flowId: string;
  readonly major: number;
  readonly minor: number;
  readonly status: FlowVersionStatus;
  readonly isCurrent: boolean;
  readonly entryNodeId: string | null;
  readonly freeTextEscapeEnabled: boolean;
  readonly escapeNodeId: string | null;
  readonly changeSummary: string | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FlowNodeRow extends FlowNodeFields {
  readonly id: string;
  readonly flowVersionId: string;
  readonly key: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FlowEdgeRow extends FlowEdgeFields {
  readonly id: string;
  readonly flowVersionId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewFlowNodeInput extends FlowNodeFields {
  readonly flowVersionId: string;
  readonly now: Date;
}

export interface UpdateFlowNodeInput {
  readonly id: string;
  readonly flowVersionId: string;
  readonly title?: string;
  readonly canvasX?: number;
  readonly canvasY?: number;
  readonly messageText?: string | null;
  readonly quickActionSetKey?: string | null;
  readonly slotName?: string | null;
  readonly optionSourceKind?: FlowNodeFields["optionSourceKind"];
  readonly optionSourceRef?: string | null;
  readonly staticOptionsJson?: string | null;
  readonly toolBindingId?: string | null;
  readonly retryCount?: number | null;
  readonly retryOnTimeout?: boolean | null;
  readonly timeoutMs?: number | null;
  readonly onFailureNodeId?: string | null;
  readonly handoverReason?: FlowNodeFields["handoverReason"];
  readonly confidenceThreshold?: number | null;
  readonly conditionExpression?: string | null;
  readonly requiredAssurance?: FlowRequiredAssuranceLevel | null;
  readonly now: Date;
}

export interface NewFlowEdgeInput extends FlowEdgeFields {
  readonly flowVersionId: string;
  readonly now: Date;
}

export interface UpdateFlowEdgeInput {
  readonly id: string;
  readonly flowVersionId: string;
  readonly label?: string | null;
  readonly ordinal?: number;
  readonly conditionExpression?: string | null;
  readonly isDefaultBranch?: boolean;
  readonly now: Date;
}

/** `TR_FlowEdges_sameVersion` rejection, translated — an edge whose endpoint belongs to a different flow version than the one being authored. */
export type FlowEdgeWriteResult =
  | { readonly ok: true; readonly edge: FlowEdgeRow }
  | { readonly ok: false; readonly reason: "flows.endpoint_wrong_version" };

export interface FlowRepository {
  getFlowVersion(flowVersionId: string): Promise<FlowVersionRow | null>;

  /** Creates a brand-new `Flow` (status `Draft`) plus its first `FlowVersion` (major.minor `0.1`, status `Draft`, `isCurrent: true`) — mirrors `PrismaAgentRepository.createAgent`'s identical two-row, FK-cycle-safe transaction shape. */
  createFlow(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowId: string; readonly flowVersionId: string }>;

  /** Returns the flow's already-Draft version unchanged, or forks a new Draft off the current Published version (`TR_FlowVersions_publishedImmutable` forbids editing a Published row directly) — the flow-side twin of `AgentRepository.forkOrReuseDraftVersion`. */
  forkOrReuseDraftVersion(input: {
    readonly flowId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowVersionId: string }>;

  listNodes(flowVersionId: string): Promise<readonly FlowNodeRow[]>;
  getNode(id: string): Promise<FlowNodeRow | null>;
  createNode(input: NewFlowNodeInput): Promise<FlowNodeRow>;
  updateNode(input: UpdateFlowNodeInput): Promise<FlowNodeRow>;
  /** Hard-deletes the node (`FlowNodes` is hard-deleted per data-model.md §1.4) and any edge referencing it. */
  deleteNode(id: string, flowVersionId: string): Promise<void>;

  listEdges(flowVersionId: string): Promise<readonly FlowEdgeRow[]>;
  createEdge(input: NewFlowEdgeInput): Promise<FlowEdgeWriteResult>;
  updateEdge(input: UpdateFlowEdgeInput): Promise<FlowEdgeWriteResult>;
  deleteEdge(id: string, flowVersionId: string): Promise<void>;

  /** Designates this version's entry node — a prerequisite `CK_FlowVersions_publishedHasEntry` needs before the version could ever be published. */
  setEntryNode(flowVersionId: string, nodeId: string, now: Date): Promise<void>;
  /** Designates this version's escape node — B7's core guarantee (`CK_FlowVersions_publishedHasEscape`): a published version cannot exist without one. */
  setEscapeNode(flowVersionId: string, nodeId: string, now: Date): Promise<void>;

  /**
   * Publishes a Draft version: sets it `Published` (permanently) + current, un-currents
   * whichever version was current before, flips `Flow.status`/`currentVersionId`. Mirrors
   * `AgentRepository.publishVersion` exactly. `entry_node_required`/`escape_node_required`
   * mirror `CK_FlowVersions_publishedHasEntry`/`publishedHasEscape` — checked here as
   * defense in depth (the primary gate is `PublishFlowVersion`'s own use-case check, and R3
   * — a condition node reachable from the entry — one layer above that, in the Server
   * Action, since this module may not import the presentational code R3 needs).
   */
  publishVersion(input: {
    readonly flowVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<
    | { readonly ok: true; readonly label: string }
    | { readonly ok: false; readonly reason: "flows.already_published" }
    | { readonly ok: false; readonly reason: "flows.entry_node_required" }
    | { readonly ok: false; readonly reason: "flows.escape_node_required" }
  >;
}

export type { FlowNodeType };
