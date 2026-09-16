import type {
  InputContextMode,
  NodeErrorPolicy,
  PipelineEdgeKind,
  PipelineNodeKind,
  PipelineVersionStatus,
} from "../domain/pipeline-vocabulary.js";

/**
 * `PipelineRepository` — the single port every `modules/orchestration/application/*-pipeline-*`
 * use case depends on, mirroring `modules/flows/ports/flow-repository.ts`'s own "one port for
 * a whole always-read/written-together aggregate" shape (`PipelineDesign`/`PipelineVersion`/
 * `PipelineNode`/`PipelineEdge`), not four independently-evolving ports.
 *
 * Deliberately agent-agnostic, same reason `flow-repository.ts` gives: nothing here knows
 * about `Agent`/`AgentVersion` — those are `modules/agents`, a sibling feature module
 * `boundaries/element-types` forbids this one from importing. A node's `agentId`/
 * `agentVersionPinId` are opaque foreign ids here; resolving "is this agent Published" is
 * `PublishedAgentPort`'s job (already shared with `UpdateRouterConfig`), composed by the
 * application layer, not this port.
 */

export interface PipelineDesignRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly status: PipelineVersionStatus;
  readonly currentVersionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PipelineVersionRow {
  readonly id: string;
  readonly pipelineDesignId: string;
  readonly major: number;
  readonly minor: number;
  readonly status: PipelineVersionStatus;
  readonly isCurrent: boolean;
  readonly entryNodeId: string | null;
  readonly maxTotalHops: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly defaultMergePolicy: string;
  readonly defaultConflictResolution: string;
  readonly routingStrategy: string;
  readonly minRoutingConfidence: number;
  readonly fallbackAgentId: string | null;
  readonly changeSummary: string | null;
  readonly publishedAt: Date | null;
  readonly clonedFromVersionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PipelineNodeRow {
  readonly id: string;
  readonly pipelineVersionId: string;
  readonly key: string;
  readonly kind: PipelineNodeKind;
  readonly title: string;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly agentId: string | null;
  readonly usesTurnBoundAgent: boolean;
  readonly agentVersionPinId: string | null;
  readonly inputContextMode: InputContextMode;
  readonly mergePolicyOverride: string | null;
  readonly conflictResolutionOverride: string | null;
  readonly isOwningEntity: boolean;
  readonly costCeilingTokensOverride: number | null;
  readonly costCeilingMicroAedOverride: number | null;
  readonly timeoutMsOverride: number | null;
  readonly onErrorPolicy: NodeErrorPolicy;
}

export interface PipelineEdgeRow {
  readonly id: string;
  readonly pipelineVersionId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: PipelineEdgeKind;
  readonly ordinal: number;
  readonly label: string | null;
  readonly maxIterations: number | null;
  readonly conditionExpression: string | null;
}

export interface PipelineCanvas {
  readonly version: PipelineVersionRow;
  readonly nodes: readonly PipelineNodeRow[];
  readonly edges: readonly PipelineEdgeRow[];
}

export interface PipelineVersionHistoryEntryRow {
  readonly id: string;
  readonly pipelineVersionId: string | null;
  readonly kind: string;
  readonly note: string;
  readonly fromVersionId: string | null;
  readonly actorStaffUserId: string;
  readonly occurredAt: Date;
}

export interface NewPipelineNodeInput {
  readonly pipelineVersionId: string;
  // `key` is deliberately absent — derived server-side from `title`
  // (`uniqueNodeKey`/`slugifyKey`), the same convention `NewFlowNodeInput` already
  // establishes, disambiguated against `UQ_PipelineNodes_pipelineVersionId_key`.
  readonly kind: PipelineNodeKind;
  readonly title: string;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly agentId: string | null;
  readonly usesTurnBoundAgent: boolean;
  readonly agentVersionPinId: string | null;
  readonly inputContextMode: InputContextMode;
  readonly isOwningEntity: boolean;
  readonly onErrorPolicy: NodeErrorPolicy;
  readonly now: Date;
}

export interface UpdatePipelineNodeInput {
  readonly id: string;
  readonly pipelineVersionId: string;
  readonly title?: string;
  readonly canvasX?: number;
  readonly canvasY?: number;
  readonly agentId?: string | null;
  readonly usesTurnBoundAgent?: boolean;
  readonly agentVersionPinId?: string | null;
  readonly inputContextMode?: InputContextMode;
  readonly mergePolicyOverride?: string | null;
  readonly conflictResolutionOverride?: string | null;
  readonly isOwningEntity?: boolean;
  readonly costCeilingTokensOverride?: number | null;
  readonly costCeilingMicroAedOverride?: number | null;
  readonly timeoutMsOverride?: number | null;
  readonly onErrorPolicy?: NodeErrorPolicy;
  readonly now: Date;
}

export interface NewPipelineEdgeInput {
  readonly pipelineVersionId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: PipelineEdgeKind;
  readonly ordinal: number;
  readonly label: string | null;
  readonly maxIterations: number | null;
  readonly conditionExpression: string | null;
  readonly now: Date;
}

export interface UpdatePipelineEdgeInput {
  readonly id: string;
  readonly pipelineVersionId: string;
  readonly kind?: PipelineEdgeKind;
  readonly ordinal?: number;
  readonly label?: string | null;
  readonly maxIterations?: number | null;
  readonly conditionExpression?: string | null;
  readonly now: Date;
}

/** `TR_PipelineEdges_sameVersion`/`TR_PipelineEdges_homogeneousFanOut` rejections, translated —
 *  the pipeline-side twin of `FlowEdgeWriteResult`. */
export type PipelineEdgeWriteResult =
  | { readonly ok: true; readonly edge: PipelineEdgeRow }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.endpoint_wrong_version" }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.non_homogeneous_fan_out" };

export type PublishPipelineVersionResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.already_published" }
  | { readonly ok: false; readonly reason: "orchestration.pipeline.graph_invalid" };

export interface PipelineRepository {
  listDesigns(): Promise<readonly PipelineDesignRow[]>;
  getDesign(pipelineDesignId: string): Promise<PipelineDesignRow | null>;
  getPipelineVersion(pipelineVersionId: string): Promise<PipelineVersionRow | null>;
  getCanvas(pipelineVersionId: string): Promise<PipelineCanvas | null>;
  listVersionHistory(pipelineDesignId: string): Promise<readonly PipelineVersionHistoryEntryRow[]>;

  /** Creates a brand-new `PipelineDesign` (status `Draft`) plus its first `PipelineVersion`
   *  (major.minor `0.1`, status `Draft`, `isCurrent: true`) and a lone `Start` node —
   *  mirrors `FlowRepository.createFlow`'s identical FK-cycle-safe transaction shape. A
   *  brand-new pipeline is never entirely empty: a `Start` node is the one node every
   *  version must have, so the canvas opens with something to wire from. */
  createPipeline(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineDesignId: string; readonly pipelineVersionId: string }>;

  /** Returns the design's already-Draft version unchanged, or forks a new Draft off the
   *  current Published version (deep-copying nodes then edges with remapped ids) —
   *  `TR_PipelineVersions_publishedImmutable` forbids editing a Published row directly.
   *  Mirrors `FlowRepository.forkOrReuseDraftVersion` exactly, including its own
   *  "next version number from historical max, never from `currentVersionId` alone" rule
   *  (`tasks/lessons.md`'s own recorded lesson on that exact bug). */
  forkOrReuseDraftVersion(input: {
    readonly pipelineDesignId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineVersionId: string }>;

  /** Updates a Draft version's own tenant-facing settings (ceilings, default merge/
   *  conflict policy, routing strategy, min routing confidence, fallback agent) — every
   *  field `RouterConfigs` itself still carries alongside its pipeline-superseded ones
   *  (§7's field-fate table). The one caller today is `scripts/backfill-pipeline-from-
   *  router-config.ts`, seeding a synthesized version with the tenant's REAL, already-
   *  configured values rather than this repository's own generic create-time defaults —
   *  a real behaviour-preservation concern, not cosmetic: a hardcoded default looser or
   *  tighter than what the tenant actually had configured would silently change its real
   *  ceilings the moment the backfilled pipeline is activated. */
  updateVersionSettings(input: {
    readonly pipelineVersionId: string;
    readonly maxTotalHops: number;
    readonly costCeilingTokens: number;
    readonly costCeilingMicroAed: number;
    readonly defaultMergePolicy: string;
    readonly defaultConflictResolution: string;
    readonly routingStrategy: string;
    readonly minRoutingConfidence: number;
    readonly fallbackAgentId: string | null;
    readonly now: Date;
  }): Promise<PipelineVersionRow>;

  createNode(input: NewPipelineNodeInput): Promise<PipelineNodeRow>;
  updateNode(input: UpdatePipelineNodeInput): Promise<PipelineNodeRow>;
  /** Hard-deletes the node and (cascade) any edge referencing it. */
  deleteNode(id: string, pipelineVersionId: string): Promise<void>;

  createEdge(input: NewPipelineEdgeInput): Promise<PipelineEdgeWriteResult>;
  updateEdge(input: UpdatePipelineEdgeInput): Promise<PipelineEdgeWriteResult>;
  deleteEdge(id: string, pipelineVersionId: string): Promise<void>;

  /** Designates this version's entry node — a prerequisite the publish gate needs. */
  setEntryNode(pipelineVersionId: string, nodeId: string, now: Date): Promise<void>;

  /** Publishes a Draft version: sets it `Published` (permanently) + current, un-currents
   *  whichever version was current before, flips `PipelineDesign.status`/`currentVersionId`,
   *  appends a `Published` history entry. Trusts the caller already ran
   *  `analyzePipelineGraph`/the server `/pipelines/validate` gate — `graph_invalid` here is
   *  defense in depth (`TR_PipelineVersions_publishGraphValid`'s own real backstop), not the
   *  primary check. */
  publishVersion(input: {
    readonly pipelineVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<PublishPipelineVersionResult>;

  /** Appends an `Activated` history entry — the audit trail half of "flipping which
   *  pipeline is live is a tenant-visible act that must be attributable" (this module's
   *  own design decision). Called by `SetActivePipelineVersion` right after
   *  `RouterConfigRepository.setActivePipelineVersion` itself succeeds; deliberately a
   *  separate call rather than folded into that method, since `RouterConfigRepository`
   *  does not own `PipelineVersionHistoryEntries`. */
  recordVersionActivation(input: {
    readonly pipelineVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void>;

  /** Rolls a design back to a previously-Published version — mirrors
   *  `PrismaAgentRepository.rollbackToVersion` exactly: changes which version is
   *  `isCurrent`/`PipelineDesign.currentVersionId`, never deletes or renumbers anything,
   *  appends a `RolledBack` history entry. Rejects only when the target is already the
   *  current version (nothing to roll back to) — the identical, sole rejection reason
   *  the agent-side precedent uses. */
  rollbackToVersion(input: {
    readonly pipelineDesignId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "orchestration.pipeline.version_is_current" }
  >;
}
